# Xero Dual-Write Architecture Analysis

**STATUS: Under review — do not implement until explicitly approved.**

## Overview
This document analyzes a critical architectural gap discovered during the implementation of the Xero synchronization feature. The core issue stems from a dual-write architecture mismatch: the primary source of truth for the CPS system uses a NoSQL-like JSON store (`app_records` table), while certain features (like reporting and timesheets) rely on separate, relational Postgres SQL "stub" tables (`practices`, `pcns`, `clinicians`).

This mismatch has resulted in several silent failures where Xero integration data is lost, UI features crash, and timesheet invoice billing amounts fallback to incorrect defaults.

---

## 1. Missing Email on Xero Sync
* **Root Cause:** The `syncClientToXero` function is currently only triggered during the creation of a PCN or Practice (`createPCN` / `createPractice`). At creation time, the frontend's "Add Client" modal does not collect any contacts—the `contacts`, `financeContacts`, and `decisionMakers` arrays are empty. These contacts are added subsequently via separate update endpoints (e.g. `updatePCN`, `updateFinanceContacts`), but these endpoints **do not** trigger a Xero sync. Thus, Xero never receives the email.
* **Proposed Fix:** Hook `syncClientToXero` into the relevant update endpoints. Xero's API natively treats repeated `POST /Contacts` requests as upserts, so re-triggering the sync upon updates is safe and will cleanly populate the missing fields.
* **Files Touched:** `backend/controllers/clientController.ts`

## 2. `xero_contact_id` Silently Lost for Practices & PCNs
* **Root Cause:** The `practices` and `pcns` SQL stub tables are *never populated* when a client is created or updated in `clientController.ts`. When `syncClientToXero` receives a successful Contact ID back from Xero, it executes an `UPDATE practices SET xero_contact_id = ...` query. Because the `practices` table has 0 rows, this query succeeds but affects no rows, silently discarding the ID. Furthermore, the ID is never written back to the primary `app_records` JSON data store, meaning the frontend UI has no idea the connection succeeded.
* **Proposed Fix:** 
  1. Create a new `syncClientStub.ts` utility (similar to the existing `syncClinicianStub.ts`) to actively mirror client data from `app_records` into the `practices` and `pcns` SQL stub tables on every creation/update.
  2. Update `syncClientToXero` to save the `xero_contact_id` to both the SQL stub table AND the primary `app_records` store.
* **Files Touched:** `backend/lib/syncClientStub.ts` (NEW), `backend/controllers/clientController.ts`, `backend/lib/xeroSync.ts`

## 3. Timesheet Invoice Billing Relies on Empty Stub Tables
* **Root Cause:** When a timesheet is approved, `syncTimesheetToXero` needs the client's `xero_contact_id` and negotiated `hourly_rate` to generate the invoice. It queries this data from the `practices` SQL stub table (`SELECT xero_contact_id, hourly_rate FROM practices`). Because this table is empty (due to Issue #2), the query returns no rows. Consequently, the invoice logic silently leaves the client unbilled (`clientContactId` = null) and falls back to a hardcoded rate of `£50` instead of the practice's actual rate.
* **Proposed Fix:** The fix for Issue #2 (implementing `syncClientStub`) will naturally resolve this by ensuring the `practices` table actually contains the correct `hourly_rate` and `xero_contact_id` for the timesheet query to find.
* **Files Touched:** Resolved via fixes to `backend/lib/syncClientStub.ts`

## 4. `/api/xero/sync-status` API Hard Crashes (Xero Codes UI)
* **Root Cause:** In `xeroController.ts`, the `getSyncStatus` endpoint runs a raw SQL query expecting a `data` JSON column (`SELECT data->>'xeroCode' FROM practices`). However, the `practices` SQL stub table doesn't have a `data` column—only the `app_records` table does. This causes a hard Postgres crash (`column "data" does not exist`) when the UI attempts to load the Xero Codes connection status.
* **Proposed Fix:** Rewrite the SQL query in `getSyncStatus` to query the `app_records` table directly, which holds the actual `data` payload and the `xeroCode` values.
* **Files Touched:** `backend/controllers/xeroController.ts`

## 5. `xero_contact_id` Lost for Clinicians
* **Root Cause:** Similar to the clients issue, `syncClinicianToXero` writes the successful Xero Contact ID *only* to the SQL `clinicians` stub table. It never saves it back to the primary `app_records` store. Because the frontend UI components generally read from `app_records` (via Mongoose-style models), the frontend is unaware that the clinician has been successfully synced to Xero.
* **Proposed Fix:** Modify `syncClinicianToXero` to ensure the `xero_contact_id` is updated in the primary `app_records` JSON storage alongside the SQL stub table update.
* **Files Touched:** `backend/lib/xeroSync.ts`
