import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const APP_RECORDS_TABLE = "app_records";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

// Store initialization state on globalThis to survive Vercel cold starts
if (!globalThis.__cpsDbState) {
  globalThis.__cpsDbState = {
    isInitialized: false,
    initPromise: null,
  };
}

let pool;

if (!globalThis.__cpsPgPool) {
  globalThis.__cpsPgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 5,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });
}

pool = globalThis.__cpsPgPool;

export async function query(text, params = []) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("[DB QUERY ERROR]", err.message);
    throw err;
  }
}

export async function ensureSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ${APP_RECORDS_TABLE} (
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model, id)
      );
    `);

    console.log("Schema ensured");
  } catch (err) {
    console.error("[DB SCHEMA ERROR]", err.message);
    throw err;
  }
}

export async function initDB() {
  if (globalThis.__cpsDbState.isInitialized) return;
  if (globalThis.__cpsDbState.initPromise) return globalThis.__cpsDbState.initPromise;

  globalThis.__cpsDbState.initPromise = (async () => {
    try {
      await pool.query("SELECT 1");
      await ensureSchema();
      globalThis.__cpsDbState.isInitialized = true;
      console.log("[DB] Connected & Ready");
    } catch (err) {
      console.error("[DB] Connection failed:", err.message);
      throw err;
    } finally {
      globalThis.__cpsDbState.initPromise = null;
    }
  })();

  return globalThis.__cpsDbState.initPromise;
}

export function isDbConnected() {
  return !!pool;
}

export async function disconnectDB() {
  try {
    await pool.end();
    globalThis.__cpsPgPool = null;
    globalThis.__cpsDbState = { isInitialized: false, initPromise: null };
    console.log("[DB] Disconnected cleanly");
  } catch (err) {
    console.error("[DB DISCONNECT ERROR]", err.message);
    throw err;
  }
}

export function mapAppRecordRow(row) {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at || null,
  };
}

export async function findAppRecordById(model, id) {
  const result = await query(
    `
      SELECT id, data, created_at, updated_at
      FROM ${APP_RECORDS_TABLE}
      WHERE model = $1 AND id = $2
      LIMIT 1
    `,
    [model, id]
  );

  return mapAppRecordRow(result.rows[0]);
}

export async function mergeAppRecordData(model, id, patch, options = {}) {
  const { throwIfMissing = false } = options;
  const payload = {
    ...(patch || {}),
    updatedAt: new Date().toISOString(),
  };

  const result = await query(
    `
      UPDATE ${APP_RECORDS_TABLE}
      SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb,
          updated_at = NOW()
      WHERE model = $1 AND id = $2
      RETURNING id, data, created_at, updated_at
    `,
    [model, id, JSON.stringify(payload)]
  );

  const record = mapAppRecordRow(result.rows[0]);
  if (!record && throwIfMissing) {
    const error = new Error(`Record not found for model "${model}" and id "${id}"`);
    error.statusCode = 404;
    error.code = "RECORD_NOT_FOUND";
    throw error;
  }

  return record;
}

export default initDB;
