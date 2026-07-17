import { query } from "../../config/db.js";
import { processCompanyJob, processContactJob, handleFailedJob } from "./hubspot.sync.js";

const LOCK_TIMEOUT_MINUTES = 5;
const BATCH_SIZE = 10;
const MAX_RETRIES = 5;

// Stale lock recovery
export async function recoverStaleJobs() {
  await query(`
    UPDATE integration_sync_jobs
    SET status = 'pending', locked_at = NULL, locked_by = NULL
    WHERE status = 'processing'
      AND locked_at < NOW() - INTERVAL '${LOCK_TIMEOUT_MINUTES} minutes'
  `);
}

// Process a batch of jobs
export async function processHubSpotJobs() {
  await recoverStaleJobs();

  const workerId = `worker-${Math.random().toString(36).substring(2, 9)}`;

  const claimResult = await query(`
    WITH selected AS (
      SELECT id FROM integration_sync_jobs
      WHERE provider = 'hubspot'
        AND status IN ('pending', 'failed')
        AND next_attempt_at <= NOW()
        AND retry_count < max_retries
      ORDER BY next_attempt_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE integration_sync_jobs
    SET status = 'processing',
        locked_at = NOW(),
        locked_by = $2
    WHERE id IN (SELECT id FROM selected)
    RETURNING *;
  `, [BATCH_SIZE, workerId]);

  const jobs = claimResult.rows;
  if (jobs.length === 0) return 0;

  for (const job of jobs) {
    try {
      if (job.entity_type === 'company') {
        await processCompanyJob(job);
      } else if (job.entity_type === 'contact') {
        await processContactJob(job);
      } else {
        throw new Error(`Unknown entity_type: ${job.entity_type}`);
      }

      await query(`
        UPDATE integration_sync_jobs
        SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [job.id]);
    } catch (err: any) {
      console.error(`[HubSpot Processor] Job ${job.id} failed:`, err.message);
      await handleFailedJob(job, err);
    }
  }

  return jobs.length;
}
