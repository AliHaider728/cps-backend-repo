import { query } from './config/db.js';
async function run() {
  const res = await query(`SELECT * FROM integration_sync_jobs WHERE status = 'dead_letter'`);
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
run();
