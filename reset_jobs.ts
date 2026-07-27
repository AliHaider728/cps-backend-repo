import { query } from './config/db.js';
async function run() {
  const res = await query(`UPDATE integration_sync_jobs SET status = 'pending', retry_count = 0, next_attempt_at = NOW(), last_error = NULL WHERE status = 'dead_letter'`);
  console.log('Reset jobs:', res.rowCount);
  process.exit(0);
}
run();
