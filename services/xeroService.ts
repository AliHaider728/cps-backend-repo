import axios from "axios";
import { query } from "../config/db.js";
import { CLIENT_INVOICE_ACCOUNT_CODE, CONTRACTOR_INVOICE_ACCOUNT_CODE } from "../config/xeroAccountCodes.js";

// Helper for retrying 429
async function withRetry(fn: () => Promise<any>, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.response?.status === 429 && attempt < maxRetries) {
        const retryAfter = err.response.headers['retry-after'] || 2;
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        attempt++;
      } else {
        throw err;
      }
    }
  }
}

function getClientId() {
  return process.env.XERO_CLIENT_ID_TEST || process.env.XERO_CLIENT_ID_PROD || "";
}

function getClientSecret() {
  return process.env.XERO_CLIENT_SECRET_TEST || process.env.XERO_CLIENT_SECRET_PROD || "";
}

function getRedirectUri() {
  return process.env.XERO_REDIRECT_URI || "http://localhost:5000/api/xero/callback";
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
      `INSERT INTO xero_audit_log (tenant_id, action_type, title, description, status, performed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, actionType, title, description, status, userId]
    );
  } catch (err) {
    console.error("Failed to write to xero_audit_log:", err);
  }
}

export async function getAuthUrl(state: string) {
  const clientId = getClientId();
  const redirectUri = encodeURIComponent(getRedirectUri());
  const scope = encodeURIComponent("openid profile email accounting.contacts accounting.transactions offline_access");
  
  const url = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
  console.log("XERO GENERATED AUTH URL:", url);
  return url;
}

export async function exchangeCode(code: string, userId: string) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const redirectUri = getRedirectUri();

  try {
    const tokenResponse = await axios.post(
      "https://identity.xero.com/connect/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    const tenantResponse = await axios.get("https://api.xero.com/connections", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!tenantResponse.data || tenantResponse.data.length === 0) {
      throw new Error("No Xero tenants connected.");
    }

    const tenant = tenantResponse.data[0];
    const tenantId = tenant.tenantId;
    const tenantName = tenant.tenantName;

    await query(`DELETE FROM xero_connections`);
    
    await query(
      `INSERT INTO xero_connections (tenant_id, tenant_name, access_token, refresh_token, expires_at, connected_by) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, tenantName, access_token, refresh_token, expiresAt.toISOString(), userId]
    );

    await logXeroAction(tenantId, "connect", `Connected to ${tenantName}`, `Successfully completed OAuth flow`, "Success", userId);
    return { tenantName, tenantId };

  } catch (err: any) {
    await logXeroAction(null, "connect", "Connection failed", err.message, "Failed", userId);
    throw err;
  }
}

export async function getConnection() {
  const res = await query(`SELECT * FROM xero_connections ORDER BY connected_at DESC LIMIT 1`);
  if (res.rows.length === 0) return null;
  
  let conn = res.rows[0];

  if (new Date(conn.expires_at).getTime() < Date.now() + 60000) {
    conn = await refreshConnection(conn);
  }

  return conn;
}

async function refreshConnection(conn: any) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  try {
    const tokenResponse = await axios.post(
      "https://identity.xero.com/connect/token",
      newSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await query(
      `UPDATE xero_connections SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now() WHERE id = $4`,
      [access_token, refresh_token, expiresAt.toISOString(), conn.id]
    );

    return { ...conn, access_token, refresh_token, expires_at: expiresAt };
  } catch (err: any) {
    console.error("Failed to refresh Xero token:", err);
    await logXeroAction(conn.tenant_id, "refresh", "Token refresh failed", err.message, "Failed", conn.connected_by);
    throw new Error("Xero connection expired and refresh failed. Please reconnect.");
  }
}

function newSearchParams(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.append(key, value);
  }
  return searchParams.toString();
}

export async function disconnectXero(userId: string) {
  const conn = await getConnection();
  try {
    await query(`DELETE FROM xero_connections`);
    if (conn) {
      await logXeroAction(conn.tenant_id, "disconnect", `Disconnected from ${conn.tenant_name}`, `Cleared connection successfully`, "Success", userId);
    }
  } catch (err: any) {
    if (conn) {
      await logXeroAction(conn.tenant_id, "disconnect", "Disconnect failed", err.message, "Failed", userId);
    }
    throw err;
  }
}

export async function getContacts() {
  const conn = await getConnection();
  if (!conn) throw new Error("Not connected to Xero");

  const res = await withRetry(() => axios.get("https://api.xero.com/api.xro/2.0/Contacts", {
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "xero-tenant-id": conn.tenant_id,
      Accept: "application/json",
    },
  }));

  return res.data.Contacts;
}

export async function syncContact(
  payload: { name: string; contactNumber?: string; email?: string; isCustomer?: boolean; isSupplier?: boolean }, 
  userId: string | null
) {
  const conn = await getConnection();
  if (!conn) {
    throw new Error("Not connected to Xero");
  }

  try {
    const contactData: any = {
      Name: payload.name,
    };
    if (payload.contactNumber) contactData.ContactNumber = payload.contactNumber;
    if (payload.email) contactData.EmailAddress = payload.email;
    if (payload.isCustomer !== undefined) contactData.IsCustomer = payload.isCustomer;
    if (payload.isSupplier !== undefined) contactData.IsSupplier = payload.isSupplier;

    const res = await withRetry(() => axios.post(
      "https://api.xero.com/api.xro/2.0/Contacts",
      { Contacts: [contactData] },
      {
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          "xero-tenant-id": conn.tenant_id,
          Accept: "application/json",
        },
      }
    ));

    const contact = res.data.Contacts[0];
    await logXeroAction(
      conn.tenant_id,
      "sync_contact",
      `Synced contact: ${payload.name}`,
      `Successfully created/updated contact in Xero`,
      "Success",
      userId
    );

    return contact;
  } catch (err: any) {
    await logXeroAction(
      conn.tenant_id,
      "sync_contact",
      `Sync failed: ${payload.name}`,
      err.response?.data?.Message || err.message || "Unknown error",
      "Failed",
      userId
    );
    throw err;
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
  const conn = await getConnection();
  if (!conn) {
    throw new Error("Not connected to Xero");
  }

  const result: { clientInvoiceId?: string; contractorInvoiceId?: string } = {};

  // Create ACCREC for Client
  if (data.clientContactId) {
    try {
      const accrecData = {
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
          }
        ],
        Status: "DRAFT"
      };

      const res = await withRetry(() => axios.post(
        "https://api.xero.com/api.xro/2.0/Invoices",
        { Invoices: [accrecData] },
        {
          headers: {
            Authorization: `Bearer ${conn.access_token}`,
            "xero-tenant-id": conn.tenant_id,
            Accept: "application/json",
          }
        }
      ));
      result.clientInvoiceId = res.data.Invoices[0].InvoiceID;
      await logXeroAction(conn.tenant_id, "create_invoice", `Created client invoice`, `Created ACCREC for ${data.reference}`, "Success", userId);
    } catch (err: any) {
      await logXeroAction(conn.tenant_id, "create_invoice", `Client invoice failed`, err.response?.data?.Message || err.message, "Failed", userId);
      // We do not throw because we want to attempt contractor invoice even if client fails, or vice versa
      console.error("ACCREC Creation failed:", err.response?.data || err.message);
    }
  }

  // Create ACCPAY for Contractor
  if (data.clinicianContactId) {
    try {
      const accpayData = {
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
          }
        ],
        Status: "DRAFT"
      };

      const res = await withRetry(() => axios.post(
        "https://api.xero.com/api.xro/2.0/Invoices",
        { Invoices: [accpayData] },
        {
          headers: {
            Authorization: `Bearer ${conn.access_token}`,
            "xero-tenant-id": conn.tenant_id,
            Accept: "application/json",
          }
        }
      ));
      result.contractorInvoiceId = res.data.Invoices[0].InvoiceID;
      await logXeroAction(conn.tenant_id, "create_invoice", `Created contractor invoice`, `Created ACCPAY for ${data.reference}`, "Success", userId);
    } catch (err: any) {
      await logXeroAction(conn.tenant_id, "create_invoice", `Contractor invoice failed`, err.response?.data?.Message || err.message, "Failed", userId);
      console.error("ACCPAY Creation failed:", err.response?.data || err.message);
    }
  }

  return result;
}
