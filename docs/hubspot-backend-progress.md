# HubSpot Backend Progress (Phase 1)

**Status: Implementation completed, pending security rotation and end-to-end validation.**

## Overview
A one-way (CPS → HubSpot) synchronization foundation has been established for approved PCNs, Practices, and their contacts. The integration uses a HubSpot Private App access token.

## Endpoints In Use (API Version 2026-03)
* **`POST /crm/objects/2026-03/companies/batch/upsert`** (Batch Upsert Company) — Uses `cps_external_key` as identifier.
* **`POST /crm/objects/2026-03/contacts/batch/upsert`** (Batch Upsert Contact) — Uses `cps_contact_external_key` as identifier.
* **`PUT /crm/v3/objects/contacts/{contactId}/associations/companies/{companyId}/contact_to_company`** (Associate Contact with Company).
* **`GET /crm/v3/properties/{objectType}/{propertyName}`** (Property Validation).

## Environment Variables
* `<HUBSPOT_TOKEN>` (Must be rotated and set as `HUBSPOT_ACCESS_TOKEN`)
* `<HUBSPOT_VERSION>` (`HUBSPOT_API_VERSION=2026-03`)
* `<CRON_SECRET>` (For securing the Cron worker endpoint)

## Database Migrations
* **`integration_sync_jobs`**: Durable queue for managing sync payloads safely. Handles idempotency, batched atomic processing (`FOR UPDATE SKIP LOCKED`), and exponential backoff retry states (`pending`, `processing`, `completed`, `failed`, `dead_letter`).
* **`hubspot_record_mappings`**: Generic mapping table (`provider`, `cps_entity_type`, `cps_entity_id`, etc.) serving as the source of truth for mapping CPS to HubSpot objects with compound unique constraints.

## Sync Flow
* The backend performs targeted updates to inject stable UUIDs (`crypto.randomUUID()`) into Contacts arrays rather than replacing the entire document.
* Jobs are only enqueued if the entity is approved and `hubspotSyncEnabled === true`.
* A Vercel Cron endpoint (`/api/hubspot/cron/sync`) securely processes batches of jobs, handling stale locks and retry logic based on `Retry-After` headers and jittered backoffs.
* Parent Company jobs process first. Contact jobs safely defer if their parent mapping is not yet established.

## HubSpot Required Custom Properties
Before running, you must create these custom properties in HubSpot:
* **Companies**: `cps_external_key` (Unique Identifier), `cps_entity_type`, `cps_record_id`
* **Contacts**: `cps_contact_external_key` (Unique Identifier), `cps_contact_type`, `cps_parent_external_key`

## Deliberately Deferred
* HubSpot → CPS bidirectional sync
* Webhooks processing
* Deals or pipeline-stage synchronization
* Conflict resolution
