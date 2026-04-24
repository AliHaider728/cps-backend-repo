/**
 * scripts/migrate-contact-history.js
 *
 * ONE-TIME migration: moves ContactHistory records from
 *   model = "ContactHistory"  (old createModel bucket)
 * to
 *   model = "client" with recordType = "ContactHistory"  (new createRepository bucket)
 *
 * Run ONCE after deploying the updated models/ContactHistory.js:
 *   node scripts/migrate-contact-history.js
 *
 * Safe to re-run — uses INSERT ON CONFLICT DO NOTHING.
 */

import dotenv from "dotenv";
dotenv.config();

import { query } from "../config/db.js";

async function migrate() {
  console.log("🔄 Starting ContactHistory migration...\n");

  // 1. Fetch all records stored under old bucket
  const { rows: oldRows } = await query(
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE model = $1`,
    ["ContactHistory"]
  );

  if (oldRows.length === 0) {
    console.log("✅ No records found in old bucket (model = 'ContactHistory').");
    console.log("   Migration not needed or already completed.");
    return;
  }

  console.log(`📦 Found ${oldRows.length} records in old bucket. Migrating...`);

  let migrated = 0;
  let skipped  = 0;
  const errors = [];

  for (const row of oldRows) {
    try {
      const newData = {
        ...(row.data || {}),
        recordType: "ContactHistory", // required fixedData discriminator
      };

      // Insert into new bucket (model = "client") — skip if already exists
      await query(
        `INSERT INTO app_records (model, id, data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (model, id) DO NOTHING`,
        ["client", row.id, JSON.stringify(newData), row.created_at, row.updated_at]
      );

      // Verify insert succeeded (ON CONFLICT DO NOTHING won't throw)
      const { rows: check } = await query(
        `SELECT id FROM app_records WHERE model = 'client' AND id = $1 LIMIT 1`,
        [row.id]
      );

      if (check.length > 0) {
        migrated++;
      } else {
        skipped++;
        console.warn(`  ⚠️  Skipped (conflict): ${row.id}`);
      }
    } catch (err) {
      errors.push({ id: row.id, error: err.message });
      console.error(`  ❌ Error migrating ${row.id}:`, err.message);
    }
  }

  console.log(`\n✅ Migration complete:`);
  console.log(`   Migrated : ${migrated}`);
  console.log(`   Skipped  : ${skipped}`);
  console.log(`   Errors   : ${errors.length}`);

  if (errors.length > 0) {
    console.log("\n❌ Failed records:");
    errors.forEach(e => console.log(`   ${e.id}: ${e.error}`));
    process.exit(1);
  }

  // 3. Only delete old records if migration was clean
  if (errors.length === 0 && migrated > 0) {
    console.log("\n🗑️  Cleaning up old bucket records...");
    const { rowCount } = await query(
      `DELETE FROM app_records WHERE model = $1`,
      ["ContactHistory"]
    );
    console.log(`   Deleted ${rowCount} records from old bucket.`);
  }

  console.log("\n🎉 Migration finished successfully.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("💥 Migration failed:", err);
  process.exit(1);
});