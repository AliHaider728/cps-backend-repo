import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // ✅ Vercel + Supabase dono ke liye zaroori
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

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
      CREATE TABLE IF NOT EXISTS app_records (
        model TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model, id)
      );
    `);
  } catch (err) {
    console.error("[DB SCHEMA ERROR]", err.message);
    throw err;
  }
}

export async function initDB() {
  try {
    await pool.query("SELECT 1");
    await ensureSchema();
    console.log("[DB] Connected & Ready");
  } catch (err) {
    console.error("[DB] Connection failed:", err.message);
    throw err;
  }
}

export function isDbConnected() {
  return true;
}

export async function disconnectDB() {
  try {
    await pool.end();
    console.log("[DB] Disconnected cleanly");
  } catch (err) {
    console.error("[DB DISCONNECT ERROR]", err.message);
    throw err;
  }
}

const connectDB = async () => initDB();

export default connectDB;