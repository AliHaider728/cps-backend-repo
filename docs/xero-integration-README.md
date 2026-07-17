# Xero Integration Progress

**STATUS: Development paused pending architecture review**

## What's Done and Working
* **OAuth Connection Flow:** Full OAuth2 flow implemented, obtaining and refreshing access tokens.
* **Contact Sync:** Basic syncing of Clients (PCNs & Practices) and Contractor Clinicians to Xero as Contacts.
* **Invoice Creation:** Draft invoice creation (ACCREC for clients, ACCPAY for contractors) triggered automatically upon Timesheet approval.
* **Audit Logging:** Xero actions are successfully logged into the `xero_audit_log` table.
* **Swagger Documentation:** All Xero routes (`/connect`, `/callback`, `/status`, `/contacts`, `/sync-status`, `/audit-log`, `/disconnect`, `/sync`) are documented with `@swagger` tags.

## Xero API Endpoints in Use
* **`POST https://identity.xero.com/connect/token`**
  * *Purpose:* Exchange auth codes for access/refresh tokens.
  * *Location:* `backend/services/xeroService.ts` (`handleCallback`, `getValidToken`)
* **`GET https://api.xero.com/connections`**
  * *Purpose:* Retrieve authorized tenant IDs.
  * *Location:* `backend/services/xeroService.ts` (`handleCallback`, `getValidToken`)
* **`POST https://api.xero.com/api.xro/2.0/Contacts`**
  * *Purpose:* Create or update contacts for clients and clinicians.
  * *Location:* `backend/services/xeroService.ts` (`syncContact`)
* **`POST https://api.xero.com/api.xro/2.0/Invoices`**
  * *Purpose:* Create draft ACCREC and ACCPAY invoices.
  * *Location:* `backend/services/xeroService.ts` (`createInvoices`)

## Environment Variables
* **`XERO_CLIENT_ID`** — OAuth application client ID.
* **`XERO_CLIENT_SECRET`** — OAuth application client secret.
* **`XERO_REDIRECT_URI`** — Where Xero redirects the user after authentication.
* **`XERO_SCOPES`** *(Optional/Hardcoded)* — Configured to `openid profile email accounting.contacts accounting.invoices offline_access`.
* **`VITE_API_URL`** — (Frontend) Used to determine the backend base URL for the "Connect to Xero" button redirect.

## Known Open Issues
* **Dual-Write Architecture Gap:** The primary JSON data store (`app_records`) is out of sync with SQL stub tables (`practices`, `pcns`), causing `xero_contact_id` fields to be silently lost, and timesheet invoice amounts to default to £50. (See `xero-dual-write-architecture-analysis.md` for full details).
* **Missing Email on Sync:** `syncClientToXero` fires on client creation before the user provides the email via the subsequent update payload.
* **`/api/xero/sync-status` API Crash:** Queries a non-existent JSON `data` column on the `practices` stub table, breaking the UI.

## Recommended Refactor & Folder Structure
Currently, Xero logic is scattered across generic backend folders (`services/`, `controllers/`, `routes/`, `lib/`). Moving forward, all third-party integrations should be isolated into an `integrations/` directory.

**Proposed Structure:**
```
backend/
  integrations/
    xero/
      xero.config.ts        // Scopes, base URLs, env var validation
      xero.service.ts       // Raw API calls to Xero endpoints
      xero.controller.ts    // Express route handlers for connection/status
      xero.routes.ts        // Express router definitions
      xero.sync.ts          // Business logic bridging CPS models to Xero service
```

## Next Steps (Pending Approval)
1. Review and approve the dual-write fix strategy with the project lead.
2. Implement the `syncClientStub` to fix data propagation between `app_records` and SQL stub tables.
3. Hook the Xero sync logic into the `updatePCN` / `updateFinanceContacts` endpoints to capture emails.
4. Refactor the scattered Xero files into the proposed `backend/integrations/xero/` folder structure.
