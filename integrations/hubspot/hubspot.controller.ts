import { Request, Response } from 'express';
import { validateHubSpotConfig } from './hubspot.config.js';
import { query } from '../../config/db.js';
import { hubspotClient } from './hubspot.client.js';

async function validateHubSpotProperties() {
  const requiredCompanyProps = [
    { name: 'cps_external_key', unique: true },
    { name: 'cps_entity_type', unique: false },
    { name: 'cps_record_id', unique: false }
  ];
  
  const requiredContactProps = [
    { name: 'cps_contact_external_key', unique: true },
    { name: 'cps_contact_type', unique: false },
    { name: 'cps_parent_external_key', unique: false }
  ];

  const checkProps = async (objectType: string, props: { name: string, unique: boolean }[]) => {
    for (const p of props) {
      try {
        const res = await hubspotClient.get(`/crm/v3/properties/${objectType}/${p.name}`);
        if (p.unique && !res.data.hasUniqueValue) {
          return `Property ${p.name} on ${objectType} exists but is not configured to require unique values.`;
        }
      } catch (err: any) {
        if (err.status === 404) {
          return `Missing required property ${p.name} on ${objectType} object.`;
        } else if (err.status === 401) {
          throw new Error('authentication_error');
        }
        throw err;
      }
    }
    return null;
  };

  const companyErr = await checkProps('companies', requiredCompanyProps);
  if (companyErr) return companyErr;

  const contactErr = await checkProps('contacts', requiredContactProps);
  if (contactErr) return contactErr;

  return null;
}

export async function getHubSpotStatus(req: Request, res: Response) {
  try {
    const isConfigured = validateHubSpotConfig();
    
    if (!isConfigured) {
      return res.json({
        success: true,
        status: 'not_configured',
        lastSync: null,
        error: 'HubSpot access token is missing from environment variables.',
      });
    }

    let configError = null;
    let status = 'connected';
    try {
      configError = await validateHubSpotProperties();
      if (configError) {
        status = 'configuration_error';
      }
    } catch (err: any) {
      if (err.message === 'authentication_error') {
        return res.json({
          success: true,
          status: 'authentication_error',
          error: 'The provided token is invalid or expired.',
        });
      }
      return res.json({
        success: true,
        status: 'api_error',
        error: 'Unable to communicate with HubSpot API.',
      });
    }

    // Get queue statistics
    const statsRes = await query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
        COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter_count,
        MAX(completed_at) as last_synced_at
      FROM integration_sync_jobs
      WHERE provider = 'hubspot'
    `);
    const stats = statsRes.rows[0];

    // Get latest error if any
    const latestErrorRes = await query(`
      SELECT last_error 
      FROM integration_sync_jobs 
      WHERE provider = 'hubspot' AND last_error IS NOT NULL 
      ORDER BY updated_at DESC LIMIT 1
    `);

    res.json({
      success: true,
      status: status,
      lastSync: stats.last_synced_at || null,
      error: configError || null,
      stats: {
        pending: parseInt(stats.pending_count || '0', 10),
        processing: parseInt(stats.processing_count || '0', 10),
        deadLetter: parseInt(stats.dead_letter_count || '0', 10),
        latestError: latestErrorRes.rows[0]?.last_error || null
      }
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      status: 'Error',
      error: 'Failed to verify HubSpot status',
    });
  }
}

export async function retryDeadLetterJob(req: Request, res: Response) {
  try {
    const jobId = req.params.id;
    let result;
    if (jobId && jobId !== 'all') {
      result = await query(`
        UPDATE integration_sync_jobs
        SET status = 'pending', retry_count = 0, next_attempt_at = NOW(), last_error = NULL
        WHERE id = $1 AND status = 'dead_letter' AND provider = 'hubspot'
        RETURNING id
      `, [jobId]);
    } else {
      result = await query(`
        UPDATE integration_sync_jobs
        SET status = 'pending', retry_count = 0, next_attempt_at = NOW(), last_error = NULL
        WHERE status = 'dead_letter' AND provider = 'hubspot'
        RETURNING id
      `);
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Job not found or no jobs in dead_letter state.' });
    }

    res.json({ success: true, message: 'Jobs requeued successfully.', count: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}
