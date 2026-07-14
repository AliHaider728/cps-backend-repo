import axios from "axios";
import dotenv from "dotenv";
import { query } from "../config/db.js";
import {
  CLIENT_INVOICE_ACCOUNT_CODE,
  CONTRACTOR_INVOICE_ACCOUNT_CODE,
} from "../config/xeroAccountCodes.js";

dotenv.config();

const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_ACCOUNTING_API_URL = "https://api.xero.com/api.xro/2.0";

/**
 * These scopes match the functions currently present in this service:
 * - accounting.contacts: read/create/update contacts
 * - accounting.invoices: read/create invoices
 * - accounting.settings.read: read Accounts, Tax Rates, Tracking Categories, Organisation, etc.
 * - offline_access: receive a refresh token
 *
 * XERO_SCOPES can contain extra scopes. Both spaces and commas are accepted in
 * the environment variable, but the final OAuth request is always sent as a
 * valid space-separated scope string.
 */
const REQUIRED_XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.settings.read",
];

function getFirstEnvironmentValue(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return null;
}

function getRequiredEnvironmentValue(...names: string[]): string {
  const value = getFirstEnvironmentValue(...names);

  if (!value) {
    throw new Error(
      `Missing Xero environment variable. Set one of: ${names.join(", ")}`
    );
  }

  return value;
}

function getClientId(): string {
  return getRequiredEnvironmentValue(
    "XERO_CLIENT_ID",
    "XERO_CLIENT_ID_TEST",
    "XERO_CLIENT_ID_PROD"
  );
}

function getClientSecret(): string {
  return getRequiredEnvironmentValue(
    "XERO_CLIENT_SECRET",
    "XERO_CLIENT_SECRET_TEST",
    "XERO_CLIENT_SECRET_PROD"
  );
}

function getRedirectUri(): string {
  return (
    process.env.XERO_REDIRECT_URI?.trim() ||
    "http://localhost:5000/api/xero/callback"
  );
}

function getScopes(): string {
  const configuredScopes = (process.env.XERO_SCOPES || "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  // Merge required scopes with any extra configured scopes and remove duplicates.
  return [...new Set([...REQUIRED_XERO_SCOPES, ...configuredScopes])].join(" ");
}

function getBasicAuthorizationHeader(): string {
  const credentials = `${getClientId()}:${getClientSecret()}`;
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function newSearchParams(params: Record<string, string>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    searchParams.append(key, value);
  }

  return searchParams.toString();
}

function getXeroErrorMessage(err: any): string {
  return (
    err?.response?.data?.error_description ||
    err?.response?.data?.error ||
    err?.response?.data?.Message ||
    err?.response?.data?.message ||
    err?.message ||
    "Unknown Xero error"
  );
}

// Helper for retrying Xero rate-limit responses.
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.response?.status !== 429 || attempt >= maxRetries) {
        throw err;
      }

      const retryAfterHeader = err.response?.headers?.["retry-after"];
      const parsedRetryAfter = Number(retryAfterHeader);
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter)
        ? parsedRetryAfter
        : 2;

      await new Promise((resolve) =>
        setTimeout(resolve, retryAfterSeconds * 1000)
      );

      attempt += 1;
    }
  }

  throw new Error("Xero request failed after retry attempts.");
}

export async function logXeroAction(
  tenantId: string | null,
  actionType: string,
  title: string,
  description: string,
  status: string,
  userId: string | null = null
) {
  try {
    await query(
      `INSERT INTO xero_audit_log
        (tenant_id, action_type, title, description, status, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, actionType, title, description, status, userId]
    );
  } catch (err) {
    console.error("Failed to write to xero_audit_log:", err);
  }
}

export async function getAuthUrl(state: string): Promise<string> {
  if (!state?.trim()) {
    throw new Error("A valid OAuth state value is required.");
  }

  const authorizationUrl = new URL(XERO_AUTHORIZE_URL);

  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: getScopes(),
    state: state.trim(),
  }).toString();

  // Avoid logging the complete URL because it contains the OAuth state value.
  console.log("Xero OAuth URL generated with scopes:", getScopes());

  return authorizationUrl.toString();
}

export async function exchangeCode(code: string, userId: string) {
  if (!code?.trim()) {
    throw new Error("Xero authorization code is missing.");
  }

  try {
    const tokenResponse = await axios.post(
      XERO_TOKEN_URL,
      newSearchParams({
        grant_type: "authorization_code",
        code: code.trim(),
        redirect_uri: getRedirectUri(),
      }),
      {
        headers: {
          Authorization: getBasicAuthorizationHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token || !expires_in) {
      throw new Error("Xero returned an incomplete token response.");
    }

    const expiresAt = new Date(Date.now() + Number(expires_in) * 1000);

    const tenantResponse = await axios.get(XERO_CONNECTIONS_URL, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json",
      },
    });

    if (!Array.isArray(tenantResponse.data) || tenantResponse.data.length === 0) {
      throw new Error("No Xero organisation was connected.");
    }

    const tenant = tenantResponse.data[0];
    const tenantId = tenant.tenantId;
    const tenantName = tenant.tenantName || "Xero organisation";

    await query("DELETE FROM xero_connections");

    await query(
      `INSERT INTO xero_connections
        (tenant_id, tenant_name, access_token, refresh_token, expires_at, connected_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        tenantName,
        access_token,
        refresh_token,
        expiresAt.toISOString(),
        userId,
      ]
    );

    await logXeroAction(
      tenantId,
      "connect",
      `Connected to ${tenantName}`,
      "Successfully completed the Xero OAuth flow",
      "Success",
      userId
    );

    return { tenantName, tenantId };
  } catch (err: any) {
    const message = getXeroErrorMessage(err);

    await logXeroAction(
      null,
      "connect",
      "Connection failed",
      message,
      "Failed",
      userId
    );

    console.error("Xero OAuth exchange failed:", err?.response?.data || err);
    throw new Error(message);
  }
}

export async function getConnection() {
  const result = await query(
    "SELECT * FROM xero_connections ORDER BY connected_at DESC LIMIT 1"
  );

  if (result.rows.length === 0) return null;

  let connection = result.rows[0];

  // Refresh one minute before expiry to avoid using a token during expiration.
  if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
    connection = await refreshConnection(connection);
  }

  return connection;
}

async function refreshConnection(connection: any) {
  try {
    const tokenResponse = await axios.post(
      XERO_TOKEN_URL,
      newSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
      {
        headers: {
          Authorization: getBasicAuthorizationHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!access_token || !refresh_token || !expires_in) {
      throw new Error("Xero returned an incomplete refresh-token response.");
    }

    const expiresAt = new Date(Date.now() + Number(expires_in) * 1000);

    await query(
      `UPDATE xero_connections
       SET access_token = $1,
           refresh_token = $2,
           expires_at = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        access_token,
        refresh_token,
        expiresAt.toISOString(),
        connection.id,
      ]
    );

    return {
      ...connection,
      access_token,
      refresh_token,
      expires_at: expiresAt.toISOString(),
    };
  } catch (err: any) {
    const message = getXeroErrorMessage(err);

    console.error(
      "Failed to refresh Xero token:",
      err?.response?.data || err
    );

    await logXeroAction(
      connection.tenant_id,
      "refresh",
      "Token refresh failed",
      message,
      "Failed",
      connection.connected_by
    );

    throw new Error(
      "Xero connection expired and the token refresh failed. Please reconnect Xero."
    );
  }
}

export async function disconnectXero(userId: string) {
  const connection = await getConnection();

  try {
    await query("DELETE FROM xero_connections");

    if (connection) {
      await logXeroAction(
        connection.tenant_id,
        "disconnect",
        `Disconnected from ${connection.tenant_name}`,
        "Cleared the local Xero connection successfully",
        "Success",
        userId
      );
    }
  } catch (err: any) {
    if (connection) {
      await logXeroAction(
        connection.tenant_id,
        "disconnect",
        "Disconnect failed",
        getXeroErrorMessage(err),
        "Failed",
        userId
      );
    }

    throw err;
  }
}

export async function getContacts() {
  const connection = await getConnection();

  if (!connection) {
    throw new Error("Not connected to Xero");
  }

  const response = await withRetry(() =>
    axios.get(`${XERO_ACCOUNTING_API_URL}/Contacts`, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        "xero-tenant-id": connection.tenant_id,
        Accept: "application/json",
      },
    })
  );

  return response.data.Contacts || [];
}

export async function syncContact(
  payload: {
    name: string;
    contactNumber?: string;
    email?: string;
    isCustomer?: boolean;
    isSupplier?: boolean;
  },
  userId: string | null
) {
  const connection = await getConnection();

  if (!connection) {
    throw new Error("Not connected to Xero");
  }

  try {
    const contactData: Record<string, unknown> = {
      Name: payload.name,
    };

    if (payload.contactNumber) {
      contactData.ContactNumber = payload.contactNumber;
    }

    if (payload.email) {
      contactData.EmailAddress = payload.email;
    }

    if (payload.isCustomer !== undefined) {
      contactData.IsCustomer = payload.isCustomer;
    }

    if (payload.isSupplier !== undefined) {
      contactData.IsSupplier = payload.isSupplier;
    }

    const response = await withRetry(() =>
      axios.post(
        `${XERO_ACCOUNTING_API_URL}/Contacts`,
        { Contacts: [contactData] },
        {
          headers: {
            Authorization: `Bearer ${connection.access_token}`,
            "xero-tenant-id": connection.tenant_id,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      )
    );

    const contact = response.data.Contacts?.[0];

    if (!contact) {
      throw new Error("Xero did not return the synced contact.");
    }

    await logXeroAction(
      connection.tenant_id,
      "sync_contact",
      `Synced contact: ${payload.name}`,
      "Successfully created or updated the contact in Xero",
      "Success",
      userId
    );

    return contact;
  } catch (err: any) {
    const message = getXeroErrorMessage(err);

    await logXeroAction(
      connection.tenant_id,
      "sync_contact",
      `Sync failed: ${payload.name}`,
      message,
      "Failed",
      userId
    );

    throw new Error(message);
  }
}

export async function createInvoices(
  data: {
    clientContactId?: string;
    clinicianContactId?: string;
    description: string;
    quantity: number;
    unitAmountClient: number;
    unitAmountContractor: number;
    date: string;
    dueDate: string;
    reference: string;
  },
  userId: string | null
) {
  const connection = await getConnection();

  if (!connection) {
    throw new Error("Not connected to Xero");
  }

  const result: {
    clientInvoiceId?: string;
    contractorInvoiceId?: string;
  } = {};

  // Create ACCREC invoice for the client.
  if (data.clientContactId) {
    try {
      const clientInvoice = {
        Type: "ACCREC",
        Contact: { ContactID: data.clientContactId },
        Date: data.date,
        DueDate: data.dueDate,
        Reference: data.reference,
        LineItems: [
          {
            Description: data.description,
            Quantity: data.quantity,
            UnitAmount: data.unitAmountClient,
            AccountCode: CLIENT_INVOICE_ACCOUNT_CODE || undefined,
          },
        ],
        Status: "DRAFT",
      };

      const response = await withRetry(() =>
        axios.post(
          `${XERO_ACCOUNTING_API_URL}/Invoices`,
          { Invoices: [clientInvoice] },
          {
            headers: {
              Authorization: `Bearer ${connection.access_token}`,
              "xero-tenant-id": connection.tenant_id,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        )
      );

      result.clientInvoiceId = response.data.Invoices?.[0]?.InvoiceID;

      await logXeroAction(
        connection.tenant_id,
        "create_invoice",
        "Created client invoice",
        `Created ACCREC for ${data.reference}`,
        "Success",
        userId
      );
    } catch (err: any) {
      const message = getXeroErrorMessage(err);

      await logXeroAction(
        connection.tenant_id,
        "create_invoice",
        "Client invoice failed",
        message,
        "Failed",
        userId
      );

      // Continue so the contractor invoice can still be attempted.
      console.error(
        "ACCREC creation failed:",
        err?.response?.data || err
      );
    }
  }

  // Create ACCPAY invoice for the contractor.
  if (data.clinicianContactId) {
    try {
      const contractorInvoice = {
        Type: "ACCPAY",
        Contact: { ContactID: data.clinicianContactId },
        Date: data.date,
        DueDate: data.dueDate,
        Reference: data.reference,
        LineItems: [
          {
            Description: data.description,
            Quantity: data.quantity,
            UnitAmount: data.unitAmountContractor,
            AccountCode: CONTRACTOR_INVOICE_ACCOUNT_CODE || undefined,
          },
        ],
        Status: "DRAFT",
      };

      const response = await withRetry(() =>
        axios.post(
          `${XERO_ACCOUNTING_API_URL}/Invoices`,
          { Invoices: [contractorInvoice] },
          {
            headers: {
              Authorization: `Bearer ${connection.access_token}`,
              "xero-tenant-id": connection.tenant_id,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        )
      );

      result.contractorInvoiceId = response.data.Invoices?.[0]?.InvoiceID;

      await logXeroAction(
        connection.tenant_id,
        "create_invoice",
        "Created contractor invoice",
        `Created ACCPAY for ${data.reference}`,
        "Success",
        userId
      );
    } catch (err: any) {
      const message = getXeroErrorMessage(err);

      await logXeroAction(
        connection.tenant_id,
        "create_invoice",
        "Contractor invoice failed",
        message,
        "Failed",
        userId
      );

      console.error(
        "ACCPAY creation failed:",
        err?.response?.data || err
      );
    }
  }

  return result;
}