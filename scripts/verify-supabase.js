import dotenv from "dotenv";
import connectDB, { disconnectDB, query } from "../config/db.js";
import { getSupabaseClient } from "../lib/supabase.js";

dotenv.config();

async function verifyDatabase() {
  await connectDB();

  const dbInfo = await query(
    "SELECT current_database() AS database_name, current_schema() AS schema_name"
  );
  const countInfo = await query(
    "SELECT COUNT(*)::int AS total FROM app_records"
  );

  return {
    databaseName: dbInfo.rows[0]?.database_name || null,
    schemaName: dbInfo.rows[0]?.schema_name || null,
    appRecordCount: countInfo.rows[0]?.total ?? 0,
  };
}

async function verifySupabaseHttp() {
  const supabase = getSupabaseClient();
  const { data, error, status } = await supabase
    .from("app_records")
    .select("id", { count: "exact" })
    .limit(1);

  return {
    status,
    rowCount: Array.isArray(data) ? data.length : 0,
    error: error ? error.message : null,
  };
}

async function main() {
  try {
    const database = await verifyDatabase();
    const http = await verifySupabaseHttp();

    console.log("Supabase database verification:");
    console.log(JSON.stringify({ database, http }, null, 2));

    if (http.error) {
      console.warn("Supabase HTTP query returned an error. Database connectivity is working, but PostgREST/RLS may still need configuration.");
    }
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error("Supabase verification failed:", err.message);
  process.exit(1);
});
