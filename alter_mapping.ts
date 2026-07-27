import { query } from './config/db.js';

async function alter() {
  try {
    await query(`TRUNCATE TABLE hubspot_record_mappings`);
    await query('ALTER TABLE hubspot_record_mappings ADD CONSTRAINT uq_hubspot_mapping UNIQUE (provider, hubspot_object_type, external_key)');
    console.log('Truncated and added unique constraint');
  } catch (err: any) {
    console.error(err.message);
  }
}
alter().then(() => process.exit(0));
