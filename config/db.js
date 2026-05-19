import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const APP_RECORDS_TABLE = "app_records";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

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
    ssl: { rejectUnauthorized: false },
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

// ─── Drop stale FK constraints ────────────────────────────────────────────────
// These FKs reference clinicians / practices / users tables that live in Supabase,
// not in this PostgreSQL instance. We drop them so inserts/updates don't fail.
// Safe to run repeatedly — IF EXISTS means no error if already gone.
async function dropStaleForeignKeys() {
  const toDrop = [
    // timesheets
    ["timesheets",         "timesheets_clinician_id_fkey"],
    ["timesheets",         "timesheets_approved_by_fkey"],
    ["timesheets",         "timesheets_rejected_by_fkey"],
    // timesheet_entries
    ["timesheet_entries",  "timesheet_entries_clinician_id_fkey"],
    ["timesheet_entries",  "timesheet_entries_surgery_id_fkey"],
    // rota_shifts
    ["rota_shifts",        "rota_shifts_clinician_id_fkey"],
    ["rota_shifts",        "rota_shifts_surgery_id_fkey"],
    ["rota_shifts",        "rota_shifts_cover_for_fkey"],
    ["rota_shifts",        "rota_shifts_created_by_fkey"],
    // base_patterns
    ["base_patterns",      "base_patterns_clinician_id_fkey"],
    ["base_patterns",      "base_patterns_surgery_id_fkey"],
    ["base_patterns",      "base_patterns_created_by_fkey"],
    // shifts
    ["shifts",             "shifts_compliance_override_by_fkey"],
    ["shifts",             "shifts_created_by_fkey"],
    ["shifts",             "shifts_original_gap_id_fkey"],
    // cover_requests
    ["cover_requests",     "cover_requests_assigned_to_fkey"],
    ["cover_requests",     "cover_requests_assigned_by_fkey"],
    ["cover_requests",     "cover_requests_created_by_fkey"],
    ["cover_requests",     "cover_requests_surgery_id_fkey"],
    // rota_distributions
    ["rota_distributions", "rota_distributions_sent_by_fkey"],
  ];

  for (const [table, constraint] of toDrop) {
    try {
      await query(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${constraint}";`
      );
    } catch (_) {
      // table may not exist yet — ignore, creation below will handle it
    }
  }
}

export async function ensureSchema() {
  try {
    // ── 1. Drop cross-DB FK constraints first ─────────────────────────────
    await dropStaleForeignKeys();

    // ── 2. app_records ────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS ${APP_RECORDS_TABLE} (
        model      TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model, id)
      );
    `);

    // ── 3. Stub lookup tables ─────────────────────────────────────────────
    // clinicians / practices / pcns / users live in Supabase, but rotaController
    // does LEFT JOINs against them in PostgreSQL queries.
    // These are read-only stubs — just enough for JOINs to resolve without error.
    // Names fall back to UUID text via COALESCE in the queries.
    await query(`
      CREATE TABLE IF NOT EXISTS clinicians (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name     TEXT,
        email         TEXT,
        clinician_type TEXT,
        contract_type TEXT
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS practices (
        id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name    TEXT,
        pcn_id  UUID
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS pcns (
        id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT,
        role  TEXT
      );
    `);

    // ── 5. shifts (legacy Shift model) ───────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id               TEXT,
        practice_id                TEXT NOT NULL,
        client_id                  TEXT,
        date                       DATE        NOT NULL,
        day_of_week                VARCHAR(10),
        start_time                 TIME,
        end_time                   TIME,
        hours                      NUMERIC(4,2),
        hourly_rate                NUMERIC(10,2),
        total_value                NUMERIC(10,2),
        clinical_system            VARCHAR(20),
        status                     VARCHAR(20) NOT NULL DEFAULT 'working'
                                   CHECK (status IN ('working','annual_leave','sick','cppe','cover','gap','cancelled')),
        is_cover                   BOOLEAN DEFAULT false,
        project_code               VARCHAR(10),
        service_code               VARCHAR(10),
        original_gap_id            UUID,
        cover_reason               TEXT,
        confirmation_received      BOOLEAN DEFAULT false,
        access_request_needed      BOOLEAN DEFAULT false,
        client_informed            BOOLEAN DEFAULT false,
        workstreams_notes          TEXT,
        clinician_notified         BOOLEAN DEFAULT false,
        hours_to_cover             NUMERIC(4,2),
        hours_covered              NUMERIC(4,2),
        compliance_checked         BOOLEAN DEFAULT false,
        compliance_override_by     TEXT,
        compliance_override_reason TEXT,
        source                     VARCHAR(20) DEFAULT 'manual',
        source_leave_id            UUID,
        created_by                 TEXT,
        created_at                 TIMESTAMPTZ DEFAULT now(),
        updated_at                 TIMESTAMPTZ DEFAULT now()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_shifts_date_practice  ON shifts(date, practice_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_shifts_clinician_date ON shifts(clinician_id, date);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_shifts_status_date    ON shifts(status, date);`);

    // ── 6. base_patterns ─────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS base_patterns (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id    UUID NOT NULL,
        surgery_id      UUID NOT NULL,
        day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time      TIME NOT NULL,
        end_time        TIME NOT NULL,
        expected_hours  DECIMAL(4,2) NOT NULL,
        contract_type   VARCHAR(20) CHECK (contract_type IN ('ARRS','EA','Direct')),
        is_active       BOOLEAN DEFAULT true,
        effective_from  DATE NOT NULL,
        effective_to    DATE,
        created_by      UUID,
        created_at      TIMESTAMPTZ DEFAULT now(),
        updated_at      TIMESTAMPTZ DEFAULT now()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_base_patterns_active ON base_patterns(is_active, day_of_week);`);

    // ── 7. rota_shifts ────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS rota_shifts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id    UUID NOT NULL,
        surgery_id      UUID,
        shift_date      DATE NOT NULL,
        shift_type      VARCHAR(20) NOT NULL DEFAULT 'working'
                        CHECK (shift_type IN ('working','annual_leave','sick','cppe_training','cover','bank_holiday')),
        start_time      TIME,
        end_time        TIME,
        expected_hours  DECIMAL(4,2),
        is_filled       BOOLEAN DEFAULT false,
        is_cover        BOOLEAN DEFAULT false,
        cover_for       UUID,
        rota_month      INTEGER NOT NULL,
        rota_year       INTEGER NOT NULL,
        sent_to_client  BOOLEAN DEFAULT false,
        created_by      UUID,
        created_at      TIMESTAMPTZ DEFAULT now(),
        updated_at      TIMESTAMPTZ DEFAULT now()
      );
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_shifts_unique_working
        ON rota_shifts(clinician_id, surgery_id, shift_date, shift_type);
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_rota_shifts_month_year ON rota_shifts(rota_year, rota_month);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rota_shifts_gap        ON rota_shifts(is_filled, shift_type, shift_date);`);

    // ── 8. timesheets ─────────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS timesheets (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id     UUID NOT NULL,
        month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        year             INTEGER NOT NULL,
        status           VARCHAR(20) DEFAULT 'draft'
                         CHECK (status IN ('draft','submitted','approved','rejected')),
        submitted_at     TIMESTAMPTZ,
        approved_at      TIMESTAMPTZ,
        approved_by      UUID,
        rejected_at      TIMESTAMPTZ,
        rejected_by      UUID,
        rejection_reason TEXT,
        total_hours      DECIMAL(6,2) DEFAULT 0,
        invoice_sent     BOOLEAN DEFAULT false,
        created_at       TIMESTAMPTZ DEFAULT now(),
        updated_at       TIMESTAMPTZ DEFAULT now(),
        UNIQUE(clinician_id, month, year)
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_timesheets_status           ON timesheets(status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_timesheets_clinician_period ON timesheets(clinician_id, year, month);`);

    // ── 9. timesheet_entries ──────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS timesheet_entries (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timesheet_id    UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
        clinician_id    UUID NOT NULL,
        surgery_id      UUID,
        shift_date      DATE NOT NULL,
        start_time      TIME,
        end_time        TIME,
        actual_hours    DECIMAL(4,2),
        expected_hours  DECIMAL(4,2),
        is_cover        BOOLEAN DEFAULT false,
        project_code    VARCHAR(50),
        service_code    VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
        notes           TEXT,
        created_at      TIMESTAMPTZ DEFAULT now(),
        updated_at      TIMESTAMPTZ DEFAULT now()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_timesheet_entries_timesheet ON timesheet_entries(timesheet_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_timesheet_entries_clinician ON timesheet_entries(clinician_id, shift_date);`);

    // ── 10. cover_requests ────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS cover_requests (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shift_id        UUID,
        rota_shift_id   UUID,
        practice_id     TEXT,
        surgery_id      UUID,
        practice_name   VARCHAR(255),
        shift_date      DATE,
        date            DATE,
        shift_start     TIME,
        shift_end       TIME,
        start_time      TIME,
        end_time        TIME,
        hours_needed    NUMERIC(4,2),
        required_skills TEXT[],
        clinical_system VARCHAR(20),
        service_code    VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
        project_code    VARCHAR(50) DEFAULT 'COVER',
        status          VARCHAR(20) DEFAULT 'open'
                        CHECK (status IN ('open','assigned','filled','cancelled')),
        filled_by       TEXT,
        assigned_to     UUID,
        assigned_by     UUID,
        assigned_at     TIMESTAMPTZ,
        email_sent_at   TIMESTAMPTZ,
        created_by      UUID,
        created_at      TIMESTAMPTZ DEFAULT now()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_cover_requests_status_date  ON cover_requests(status, shift_date);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_cover_requests_status_date2 ON cover_requests(status, date);`);

    // ── 11. rota_distributions ────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS rota_distributions (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        TEXT NOT NULL,
        client_name      VARCHAR(255),
        month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        year             INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
        sent_by          UUID,
        sent_at          TIMESTAMPTZ DEFAULT now(),
        recipient_emails TEXT[]
      );
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_dist_unique
        ON rota_distributions(client_id, month, year);
    `);

    // ── 12. time_entries ──────────────────────────────────────────────────
    await query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id TEXT NOT NULL,
        shift_id     UUID,
        clock_in     TIMESTAMPTZ NOT NULL DEFAULT now(),
        clock_out    TIMESTAMPTZ,
        actual_hours NUMERIC(6,2),
        status       VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_active
        ON time_entries(clinician_id)
        WHERE status = 'active';
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_time_entries_clinician ON time_entries(clinician_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_time_entries_shift     ON time_entries(shift_id);`);

    console.log("[DB] Schema ensured — all tables ready");
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
    `SELECT id, data, created_at, updated_at
       FROM ${APP_RECORDS_TABLE}
      WHERE model = $1 AND id = $2
      LIMIT 1`,
    [model, id]
  );
  return mapAppRecordRow(result.rows[0]);
}

export async function mergeAppRecordData(model, id, patch, options = {}) {
  const { throwIfMissing = false } = options;
  const payload = { ...(patch || {}), updatedAt: new Date().toISOString() };

  const result = await query(
    `UPDATE ${APP_RECORDS_TABLE}
        SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE model = $1 AND id = $2
      RETURNING id, data, created_at, updated_at`,
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