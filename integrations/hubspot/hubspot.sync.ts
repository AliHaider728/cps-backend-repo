import { hubspotClient } from './hubspot.client.js';
import { mapClientToCompany, mapContactToHubSpotContact } from './hubspot.mapping.js';
import { query } from '../../config/db.js';

export function isHubSpotSyncEligible(entity: any, entityType: string): boolean {
  if (entityType !== 'pcn' && entityType !== 'practice') return false;
  if (!entity.hubspotSyncEnabled) return false;
  if (entity.isActive === false) return false;
  return true;
}

export async function enqueueHubSpotJob(action: string, entityType: string, entityId: string, payload: any, idempotencyKey: string) {
  try {
    await query(`
      INSERT INTO integration_sync_jobs 
      (provider, action, entity_type, entity_id, payload, idempotency_key)
      VALUES ('hubspot', $1, $2, $3, $4, $5)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [action, entityType, entityId, JSON.stringify(payload), idempotencyKey]);
  } catch (err: any) {
    console.error(`[HubSpot Queue] Error enqueueing job ${idempotencyKey}:`, err.message);
  }
}

export async function handleFailedJob(job: any, err: any) {
  const isRetryable = err.status === 429 || (err.status >= 500 && err.status < 600) || err.code === 'ECONNRESET' || !err.status;
  
  if (isRetryable && job.retry_count + 1 < job.max_retries) {
    const nextRetryCount = job.retry_count + 1;
    let delayMs = Math.pow(2, nextRetryCount) * 1000 + Math.random() * 1000;
    
    // Check if Retry-After is available
    if (err.headers && err.headers['retry-after']) {
      const retryAfter = parseInt(err.headers['retry-after'], 10);
      if (!isNaN(retryAfter)) {
        delayMs = Math.max(delayMs, retryAfter * 1000);
      }
    }

    const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();

    await query(`
      UPDATE integration_sync_jobs
      SET status = 'pending',
          retry_count = $1,
          next_attempt_at = $2,
          last_error = $3,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $4
    `, [nextRetryCount, nextAttemptAt, err.message?.substring(0, 500) || 'Unknown error', job.id]);
  } else {
    await query(`
      UPDATE integration_sync_jobs
      SET status = 'dead_letter',
          last_error = $1,
          locked_by = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $2
    `, [err.message?.substring(0, 500) || 'Unknown error', job.id]);
  }
}

export async function upsertMapping(
  cps_entity_type: string, cps_entity_id: string,
  cps_parent_type: string | null, cps_parent_id: string | null,
  contact_bucket: string | null, hubspot_object_type: string,
  hubspot_object_id: string | null, external_key: string,
  sync_status: string, last_error: string | null
) {
  await query(
    `INSERT INTO hubspot_record_mappings 
      (provider, cps_entity_type, cps_entity_id, cps_parent_type, cps_parent_id, contact_bucket, hubspot_object_type, hubspot_object_id, external_key, sync_status, last_synced_at, last_error)
     VALUES ('hubspot', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)
     ON CONFLICT (provider, hubspot_object_type, external_key) DO UPDATE SET
      hubspot_object_id = EXCLUDED.hubspot_object_id,
      sync_status = EXCLUDED.sync_status,
      last_synced_at = NOW(),
      last_error = EXCLUDED.last_error
    `,
    [cps_entity_type, cps_entity_id, cps_parent_type, cps_parent_id, contact_bucket, hubspot_object_type, hubspot_object_id, external_key, sync_status, last_error]
  );
}

export async function processCompanyJob(job: any) {
  const { entityId, entity, entityType } = job.payload;
  const payload = mapClientToCompany(entityId, entity, entityType);
  const externalKey = payload.properties.cps_external_key;

  const requestBody = {
    inputs: [
      {
        idProperty: "cps_external_key",
        id: externalKey,
        properties: payload.properties
      }
    ]
  };

  const res = await hubspotClient.post(`/crm/objects/2026-03/companies/batch/upsert`, requestBody);
  const companyId = res.data?.results?.[0]?.id;

  if (!companyId) {
    throw new Error("No company ID returned from HubSpot upsert");
  }

  await upsertMapping(entityType, entityId, null, null, null, 'company', companyId, externalKey, 'success', null);
  return companyId;
}

export async function processContactJob(job: any) {
  const { contactId, contactData, parentKey, clientId, bucket } = job.payload;
  
  // Check if parent company exists in mappings first
  const parentMappingRes = await query(`SELECT hubspot_object_id FROM hubspot_record_mappings WHERE provider = 'hubspot' AND hubspot_object_type = 'company' AND external_key = $1`, [parentKey]);
  const parentMapping = parentMappingRes.rows[0];
  
  if (!parentMapping || !parentMapping.hubspot_object_id) {
    throw new Error("Parent company mapping not found. Contact job should be rescheduled.");
  }
  const companyId = parentMapping.hubspot_object_id;

  const payload = mapContactToHubSpotContact(contactId, contactData, parentKey, bucket);
  const externalKey = payload.properties.cps_contact_external_key;

  const requestBody = {
    inputs: [
      {
        idProperty: "cps_contact_external_key",
        id: externalKey,
        properties: payload.properties
      }
    ]
  };

  let hubspotContactId: string | undefined;

  try {
    const res = await hubspotClient.post(`/crm/objects/2026-03/contacts/batch/upsert`, requestBody);
    hubspotContactId = res.data?.results?.[0]?.id;
  } catch (err: any) {
    if (err.message && err.message.includes('409') && err.message.includes('Contact already exists')) {
      // Extract existing ID from error message: "Contact already exists. Existing ID: 520953303760"
      const match = err.message.match(/Existing ID: (\d+)/);
      if (match && match[1]) {
        hubspotContactId = match[1];
        // Patch the existing contact with our properties and custom key
        await hubspotClient.patch(`/crm/v3/objects/contacts/${hubspotContactId}`, {
          properties: payload.properties
        });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  if (!hubspotContactId) {
    throw new Error("No contact ID returned from HubSpot upsert");
  }

  // Association (idempotent, we can just PUT it to ensure it's associated)
  // HubSpot batch association could also be used, but /associations/ is fine if needed
  // /crm/v3/... wait, they requested 2026-03 version endpoints where possible, but associations might be v4 or v3
  // I will use v3 associations or v4 since associations don't always have a 2026-03 endpoint.
  await hubspotClient.put(
    `/crm/v3/objects/contacts/${hubspotContactId}/associations/companies/${companyId}/contact_to_company`,
    []
  );

  await upsertMapping('contact', contactId, 'client', clientId, bucket, 'contact', hubspotContactId, externalKey, 'success', null);
}
