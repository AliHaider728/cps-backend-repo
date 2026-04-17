import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

// ─────────────────────────────
// ENV CHECK
// ─────────────────────────────
if (!process.env.DATABASE_URL) {
  throw new Error("  DATABASE_URL is missing in environment variables");
}

// ─────────────────────────────
// GLOBAL POOL (IMPORTANT for serverless reuse)
// ─────────────────────────────
let pool;

if (!global._pgPool) {
  global._pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: {
      rejectUnauthorized: false, //  Supabase required
    },

    // 🔥 Serverless optimized
    max: 5, // low connections (important for Vercel)
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });
}

pool = global._pgPool;

// ─────────────────────────────
// QUERY FUNCTION
// ─────────────────────────────
export async function query(text, params = []) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    console.error("  [DB QUERY ERROR]", err.message);
    throw err;
  }
}

// ─────────────────────────────
// SCHEMA SETUP
// ─────────────────────────────
export async function ensureSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS app_records (
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model, id)
      );
    `);

    console.log(" Schema ensured");
  } catch (err) {
    console.error("  [DB SCHEMA ERROR]", err.message);
    throw err;
  }
}

// ─────────────────────────────
// INIT DB (SAFE - run once)
// ─────────────────────────────
let isInitialized = false;

export async function initDB() {
  if (isInitialized) return;

  try {
    await pool.query("SELECT 1");
    await ensureSchema();

    isInitialized = true;

    console.log("  [DB] Connected & Ready");
  } catch (err) {
    console.error("  [DB] Connection failed:", err.message);
    throw err;
  }
}

// ─────────────────────────────
// HEALTH CHECK HELPER
// ─────────────────────────────
export function isDbConnected() {
  return !!pool;
}

// ─────────────────────────────
// DISCONNECT (optional, mostly local)
// ─────────────────────────────
export async function disconnectDB() {
  try {
    await pool.end();
    global._pgPool = null;
    console.log("  [DB] Disconnected cleanly");
  } catch (err) {
    console.error("  [DB DISCONNECT ERROR]", err.message);
    throw err;
  }
}

// ─────────────────────────────
// DEFAULT EXPORT
// ─────────────────────────────
export default initDB;