import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

let pool;
let initPromise;
let connected = false;

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL is not configured");
  }
  return value;
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export function isDbConnected() {
  return connected;
}

export async function query(text, params = []) {
  const client = getPool();
  return client.query(text, params);
}

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_records (
      model TEXT NOT NULL,
      id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (model, id)
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_app_records_model_updated
    ON app_records (model, updated_at DESC);
  `);
}

const connectDB = async () => {
  if (!initPromise) {
    initPromise = (async () => {
      const client = getPool();
      await client.query("SELECT 1");
      await ensureSchema();
      connected = true;
      return client;
    })().catch((err) => {
      connected = false;
      initPromise = null;
      throw err;
    });
  }

  return initPromise;
};

export async function disconnectDB() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  initPromise = null;
  connected = false;
}

export default connectDB;
