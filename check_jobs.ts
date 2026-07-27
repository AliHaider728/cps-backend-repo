import { query } from './config/db.js';

async function run() {
  const res = await query('SELECT id, entity_type, status, last_error FROM integration_sync_jobs');
  console.log(res.rows);
  process.exit(0);
}
run();
