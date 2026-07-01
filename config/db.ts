import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const APP_RECORDS_TABLE = "app_records";

declare global {
  var __cpsDbState: {
    isInitialized: boolean;
    initPromise: Promise<void> | null;
  };
  var __cpsPgPool: pkg.Pool | null;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in environment variables");
}

if (!globalThis.__cpsDbState) {
  globalThis.__cpsDbState = {
    isInitialized: false,
    initPromise: null,
  };
}

let pool: pkg.Pool;

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

// ─── Raw pool query (no throw-logging, used during migrations) ────────────────
async function rawQuery(text: string, params: any[] = []) {
  return pool.query(text, params);
}

export async function query(text: string, params: any[] = []) {
  try {
    return await pool.query(text, params);
  } catch (err: any) {
    console.error("[DB QUERY ERROR]", err.message);
    throw err;
  }
}

// ─── Check if a column exists ─────────────────────────────────────────────────
async function columnExists(table: string, column: string) {
  const res = await rawQuery(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Check if a table exists ──────────────────────────────────────────────────
async function tableExists(table: string) {
  const res = await rawQuery(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [table]
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Check if an index exists ─────────────────────────────────────────────────
async function indexExists(indexName: string) {
  const res = await rawQuery(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1 LIMIT 1`,
    [indexName]
  );
  return (res.rowCount ?? 0) > 0;
}

// ─── Add column only if missing ───────────────────────────────────────────────
async function addColIfMissing(table: string, column: string, definition: string) {
  if (!(await tableExists(table))) return;
  if (await columnExists(table, column)) return;
  try {
    await rawQuery(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    console.log(`[DB MIGRATE] Added ${table}.${column}`);
  } catch (err: any) {
    console.warn(`[DB MIGRATE] Could not add ${table}.${column}:`, err.message);
  }
}

// ─── Rename column if old name exists and new name doesn't ───────────────────
async function renameColIfNeeded(table: string, oldCol: string, newCol: string) {
  if (!(await tableExists(table))) return;
  const hasOld = await columnExists(table, oldCol);
  const hasNew = await columnExists(table, newCol);
  if (hasOld && !hasNew) {
    try {
      await rawQuery(`ALTER TABLE ${table} RENAME COLUMN ${oldCol} TO ${newCol};`);
      console.log(`[DB MIGRATE] Renamed ${table}.${oldCol} → ${newCol}`);
    } catch (err: any) {
      console.warn(`[DB MIGRATE] Could not rename ${table}.${oldCol}:`, err.message);
    }
  }
}

// ─── Create index safely ──────────────────────────────────────────────────────
async function createIndexSafe(name: string, sql: string) {
  if (await indexExists(name)) return;
  try {
    await rawQuery(sql);
  } catch (err: any) {
    console.warn(`[DB INDEX] Could not create ${name}:`, err.message);
  }
}

// ─── Drop stale FK constraints ────────────────────────────────────────────────
async function dropStaleForeignKeys() {
  const toDrop = [
    ["timesheets",         "timesheets_clinician_id_fkey"],
    ["timesheets",         "timesheets_approved_by_fkey"],
    ["timesheets",         "timesheets_rejected_by_fkey"],
    ["timesheet_entries",  "timesheet_entries_clinician_id_fkey"],
    ["timesheet_entries",  "timesheet_entries_surgery_id_fkey"],
    ["rota_shifts",        "rota_shifts_clinician_id_fkey"],
    ["rota_shifts",        "rota_shifts_surgery_id_fkey"],
    ["rota_shifts",        "rota_shifts_cover_for_fkey"],
    ["rota_shifts",        "rota_shifts_created_by_fkey"],
    ["base_patterns",      "base_patterns_clinician_id_fkey"],
    ["base_patterns",      "base_patterns_surgery_id_fkey"],
    ["base_patterns",      "base_patterns_created_by_fkey"],
    ["shifts",             "shifts_compliance_override_by_fkey"],
    ["shifts",             "shifts_created_by_fkey"],
    ["shifts",             "shifts_original_gap_id_fkey"],
    ["cover_requests",     "cover_requests_assigned_to_fkey"],
    ["cover_requests",     "cover_requests_assigned_by_fkey"],
    ["cover_requests",     "cover_requests_created_by_fkey"],
    ["cover_requests",     "cover_requests_surgery_id_fkey"],
    ["rota_distributions", "rota_distributions_sent_by_fkey"],
  ];
  for (const [table, constraint] of toDrop) {
    try {
      await rawQuery(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "${constraint}";`);
    } catch (_) {}
  }
}

// ─── MIGRATIONS — always runs BEFORE CREATE TABLE / CREATE INDEX ──────────────
async function runMigrations() {
  // rota_shifts: old schema used "date", new schema uses "shift_date"
  await renameColIfNeeded("rota_shifts", "date", "shift_date");

  // rota_shifts: add any missing columns
  await addColIfMissing("rota_shifts", "surgery_id",     "UUID");
  await addColIfMissing("rota_shifts", "shift_type",     "VARCHAR(20) NOT NULL DEFAULT 'working'");
  await addColIfMissing("rota_shifts", "start_time",     "TIME");
  await addColIfMissing("rota_shifts", "end_time",       "TIME");
  await addColIfMissing("rota_shifts", "expected_hours", "DECIMAL(4,2)");
  await addColIfMissing("rota_shifts", "is_filled",      "BOOLEAN DEFAULT false");
  await addColIfMissing("rota_shifts", "is_cover",       "BOOLEAN DEFAULT false");
  await addColIfMissing("rota_shifts", "cover_for",      "UUID");
  await addColIfMissing("rota_shifts", "rota_month",     "INTEGER");
  await addColIfMissing("rota_shifts", "rota_year",      "INTEGER");
  await addColIfMissing("rota_shifts", "sent_to_client", "BOOLEAN DEFAULT false");
  await addColIfMissing("rota_shifts", "created_by",     "UUID");

  // timesheets: seed.js and Supabase client inserts expect created_by
  await addColIfMissing("timesheets", "created_by", "UUID REFERENCES users(id)");

  // timesheet_entries: old schema may have used "entry_date"
  await renameColIfNeeded("timesheet_entries", "entry_date", "shift_date");
  await addColIfMissing("timesheet_entries", "shift_date", "DATE NOT NULL DEFAULT CURRENT_DATE");

  // cover_requests: ensure both date variants exist
  await addColIfMissing("cover_requests", "shift_date",    "DATE");
  await addColIfMissing("cover_requests", "date",          "DATE");
  await addColIfMissing("cover_requests", "shift_start",   "TIME");
  await addColIfMissing("cover_requests", "shift_end",     "TIME");
  await addColIfMissing("cover_requests", "start_time",    "TIME");
  await addColIfMissing("cover_requests", "end_time",      "TIME");
  await addColIfMissing("cover_requests", "rota_shift_id", "UUID");

  // time_entries
  await addColIfMissing("time_entries", "shift_id", "UUID");

  // shifts: newer columns
  await addColIfMissing("shifts", "client_id",                  "TEXT");
  await addColIfMissing("shifts", "compliance_checked",         "BOOLEAN DEFAULT false");
  await addColIfMissing("shifts", "compliance_override_by",     "TEXT");
  await addColIfMissing("shifts", "compliance_override_reason", "TEXT");
  await addColIfMissing("shifts", "source",                     "VARCHAR(20) DEFAULT 'manual'");
  await addColIfMissing("shifts", "source_leave_id",            "UUID");

  await addColIfMissing("practices", "clinical_system", "VARCHAR(50)");
  await addColIfMissing("practices", "type",            "VARCHAR(20)");

  await addColIfMissing("clinicians", "user_id",         "UUID");
  await addColIfMissing("clinicians", "smartcard",       "TEXT");
  await addColIfMissing("clinicians", "start_date",      "DATE");
  await addColIfMissing("clinicians", "end_date",        "DATE");
  await addColIfMissing("clinicians", "ops_lead_id",     "TEXT");
  await addColIfMissing("clinicians", "supervisor_id",   "TEXT");
  await addColIfMissing("clinicians", "leave_balances",  "JSONB DEFAULT '[]'::jsonb");
}

async function ensureProjectMappingsTable() {
  await rawQuery(`
    CREATE TABLE IF NOT EXISTS project_mappings (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clinician_id   TEXT NOT NULL,
      project        TEXT,
      practice_id    TEXT,
      type           TEXT CHECK (type IN ('Locums Contractor','Employed','Limited Company')),
      rate           NUMERIC,
      rate_type      TEXT CHECK (rate_type IN ('Per Hour','Fixed')),
      vat_percentage NUMERIC DEFAULT 0.00,
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await createIndexSafe(
    "idx_project_mappings_clinician",
    `CREATE INDEX idx_project_mappings_clinician ON project_mappings(clinician_id);`
  );
}

// ─── Main schema setup ────────────────────────────────────────────────────────
export async function ensureSchema() {
  try {
    await dropStaleForeignKeys();

    // !! MIGRATIONS FIRST — before any CREATE TABLE or CREATE INDEX !!
    await runMigrations();

    // app_records
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS ${APP_RECORDS_TABLE} (
        model      TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (model, id)
      );
    `);

    // Stub lookup tables
    await rawQuery(`CREATE TABLE IF NOT EXISTS clinicians (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), full_name TEXT, email TEXT,
      clinician_type TEXT, contract_type TEXT
    );`);
    await rawQuery(`CREATE TABLE IF NOT EXISTS practices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, pcn_id UUID
    );`);
    await rawQuery(`CREATE TABLE IF NOT EXISTS pcns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT
    );`);
    await rawQuery(`CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK (type IN ('icb','federation','pcn','practice','ea')),
      clinical_system VARCHAR(50)
    );`);

    try {
      await rawQuery(`
        INSERT INTO clients (id, name, type, clinical_system)
        SELECT p.id, p.name, COALESCE(p.type, 'practice'), p.clinical_system
          FROM practices p
         WHERE p.name IS NOT NULL
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = COALESCE(EXCLUDED.type, clients.type),
          clinical_system = COALESCE(EXCLUDED.clinical_system, clients.clinical_system)
      `);
      await rawQuery(`
        INSERT INTO clients (id, name, type, clinical_system)
        SELECT pr.id,
               COALESCE(pr.data->>'name', pr.data->>'practiceName'),
               COALESCE(pr.data->>'type', 'practice'),
               COALESCE(pr.data->>'clinicalSystem', pr.data->>'system')
          FROM app_records pr
         WHERE pr.model IN ('practice', 'Practice', 'Client', 'client')
           AND COALESCE(pr.data->>'name', pr.data->>'practiceName') IS NOT NULL
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          type = COALESCE(EXCLUDED.type, clients.type),
          clinical_system = COALESCE(EXCLUDED.clinical_system, clients.clinical_system)
      `);
    } catch (backfillErr: any) {
      console.warn("[DB] clients backfill skipped:", backfillErr.message);
    }
    await rawQuery(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, role TEXT
    );`);

    // shifts
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS shifts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id TEXT, practice_id TEXT NOT NULL, client_id TEXT,
        date DATE NOT NULL, day_of_week VARCHAR(10), start_time TIME, end_time TIME,
        hours NUMERIC(4,2), hourly_rate NUMERIC(10,2), total_value NUMERIC(10,2),
        clinical_system VARCHAR(20),
        status VARCHAR(20) NOT NULL DEFAULT 'working'
          CHECK (status IN ('working','annual_leave','sick','cppe','cover','gap','cancelled')),
        is_cover BOOLEAN DEFAULT false, project_code VARCHAR(10), service_code VARCHAR(10),
        original_gap_id UUID, cover_reason TEXT,
        confirmation_received BOOLEAN DEFAULT false, access_request_needed BOOLEAN DEFAULT false,
        client_informed BOOLEAN DEFAULT false, workstreams_notes TEXT,
        clinician_notified BOOLEAN DEFAULT false, hours_to_cover NUMERIC(4,2),
        hours_covered NUMERIC(4,2), compliance_checked BOOLEAN DEFAULT false,
        compliance_override_by TEXT, compliance_override_reason TEXT,
        source VARCHAR(20) DEFAULT 'manual', source_leave_id UUID, created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await createIndexSafe("idx_shifts_date_practice",  `CREATE INDEX idx_shifts_date_practice  ON shifts(date, practice_id);`);
    await createIndexSafe("idx_shifts_clinician_date", `CREATE INDEX idx_shifts_clinician_date ON shifts(clinician_id, date);`);
    await createIndexSafe("idx_shifts_status_date",    `CREATE INDEX idx_shifts_status_date    ON shifts(status, date);`);

    // base_patterns
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS base_patterns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id UUID NOT NULL, surgery_id UUID NOT NULL,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL, end_time TIME NOT NULL,
        expected_hours DECIMAL(4,2) NOT NULL,
        contract_type VARCHAR(20) CHECK (contract_type IN ('ARRS','EA','Direct')),
        is_active BOOLEAN DEFAULT true, effective_from DATE NOT NULL, effective_to DATE,
        created_by UUID, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await createIndexSafe("idx_base_patterns_active", `CREATE INDEX idx_base_patterns_active ON base_patterns(is_active, day_of_week);`);

    // rota_shifts — shift_date is guaranteed after runMigrations()
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS rota_shifts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id UUID NOT NULL, surgery_id UUID,
        shift_date DATE NOT NULL,
        shift_type VARCHAR(20) NOT NULL DEFAULT 'working'
          CHECK (shift_type IN ('working','annual_leave','sick','cppe_training','cover','bank_holiday')),
        start_time TIME, end_time TIME, expected_hours DECIMAL(4,2),
        is_filled BOOLEAN DEFAULT false, is_cover BOOLEAN DEFAULT false, cover_for UUID,
        rota_month INTEGER NOT NULL DEFAULT EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER,
        rota_year  INTEGER NOT NULL DEFAULT EXTRACT(YEAR  FROM CURRENT_DATE)::INTEGER,
        sent_to_client BOOLEAN DEFAULT false, created_by UUID,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await createIndexSafe("idx_rota_shifts_unique_working",
      `CREATE UNIQUE INDEX idx_rota_shifts_unique_working
         ON rota_shifts(clinician_id, surgery_id, shift_date, shift_type);`);
    await createIndexSafe("idx_rota_shifts_month_year", `CREATE INDEX idx_rota_shifts_month_year ON rota_shifts(rota_year, rota_month);`);
    await createIndexSafe("idx_rota_shifts_gap",        `CREATE INDEX idx_rota_shifts_gap        ON rota_shifts(is_filled, shift_type, shift_date);`);

    // timesheets
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS timesheets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id UUID NOT NULL, month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        year INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'draft'
          CHECK (status IN ('draft','submitted','approved','rejected')),
        submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, approved_by UUID,
        rejected_at TIMESTAMPTZ, rejected_by UUID, rejection_reason TEXT,
        total_hours DECIMAL(6,2) DEFAULT 0, invoice_sent BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(clinician_id, month, year)
      );
    `);
    await createIndexSafe("idx_timesheets_status",           `CREATE INDEX idx_timesheets_status           ON timesheets(status);`);
    await createIndexSafe("idx_timesheets_clinician_period", `CREATE INDEX idx_timesheets_clinician_period ON timesheets(clinician_id, year, month);`);

    // timesheet_entries
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS timesheet_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        timesheet_id UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,
        clinician_id UUID NOT NULL, surgery_id UUID,
        shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
        start_time TIME, end_time TIME, actual_hours DECIMAL(4,2), expected_hours DECIMAL(4,2),
        is_cover BOOLEAN DEFAULT false, project_code VARCHAR(50),
        service_code VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
        notes TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await createIndexSafe("idx_timesheet_entries_timesheet", `CREATE INDEX idx_timesheet_entries_timesheet ON timesheet_entries(timesheet_id);`);
    await createIndexSafe("idx_timesheet_entries_clinician", `CREATE INDEX idx_timesheet_entries_clinician ON timesheet_entries(clinician_id, shift_date);`);

    // cover_requests
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS cover_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shift_id UUID, rota_shift_id UUID, practice_id TEXT, surgery_id UUID,
        practice_name VARCHAR(255), shift_date DATE, date DATE,
        shift_start TIME, shift_end TIME, start_time TIME, end_time TIME,
        hours_needed NUMERIC(4,2), required_skills TEXT[], clinical_system VARCHAR(20),
        service_code VARCHAR(20) CHECK (service_code IN ('PCN','GP','EA')),
        project_code VARCHAR(50) DEFAULT 'COVER',
        status VARCHAR(20) DEFAULT 'open'
          CHECK (status IN ('open','assigned','filled','cancelled')),
        filled_by TEXT, assigned_to UUID, assigned_by UUID, assigned_at TIMESTAMPTZ,
        email_sent_at TIMESTAMPTZ, created_by UUID, created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await createIndexSafe("idx_cover_requests_status_date",  `CREATE INDEX idx_cover_requests_status_date  ON cover_requests(status, shift_date);`);
    await createIndexSafe("idx_cover_requests_status_date2", `CREATE INDEX idx_cover_requests_status_date2 ON cover_requests(status, date);`);

    // rota_distributions
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS rota_distributions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL, client_name VARCHAR(255),
        month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        year  INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
        sent_by UUID, sent_at TIMESTAMPTZ DEFAULT now(), recipient_emails TEXT[]
      );
    `);
    await createIndexSafe("idx_rota_dist_unique",
      `CREATE UNIQUE INDEX idx_rota_dist_unique ON rota_distributions(client_id, month, year);`);

    // time_entries
    await rawQuery(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clinician_id TEXT NOT NULL, shift_id UUID,
        clock_in  TIMESTAMPTZ NOT NULL DEFAULT now(),
        clock_out TIMESTAMPTZ, actual_hours NUMERIC(6,2),
        status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','completed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await createIndexSafe("idx_time_entries_one_active",
      `CREATE UNIQUE INDEX idx_time_entries_one_active
         ON time_entries(clinician_id) WHERE status = 'active';`);
    await createIndexSafe("idx_time_entries_clinician", `CREATE INDEX idx_time_entries_clinician ON time_entries(clinician_id);`);
    await createIndexSafe("idx_time_entries_shift",     `CREATE INDEX idx_time_entries_shift     ON time_entries(shift_id);`);

    await ensureProjectMappingsTable();

    console.log("[DB] Schema ensured — all tables ready");
  } catch (err: any) {
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
    } catch (err: any) {
      console.error("[DB] Connection failed:", err.message);
      throw err;
    } finally {
      globalThis.__cpsDbState.initPromise = null;
    }
  })();

  return globalThis.__cpsDbState.initPromise;
}

export function isDbConnected() { return !!pool; }

export async function disconnectDB() {
  try {
    await pool.end();
    globalThis.__cpsPgPool = null;
    globalThis.__cpsDbState = { isInitialized: false, initPromise: null };
    console.log("[DB] Disconnected cleanly");
  } catch (err: any) {
    console.error("[DB DISCONNECT ERROR]", err.message);
    throw err;
  }
}

export function mapAppRecordRow(row: any) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at || null,
  };
}

export async function findAppRecordById(model: string, id: string) {
  const result = await query(
    `SELECT id, data, created_at, updated_at FROM ${APP_RECORDS_TABLE}
      WHERE model = $1 AND id = $2 LIMIT 1`,
    [model, id]
  );
  return mapAppRecordRow(result.rows[0]);
}

export async function mergeAppRecordData(model: string, id: string, patch: any, options: { throwIfMissing?: boolean } = {}) {
  const { throwIfMissing = false } = options;
  const payload = { ...(patch || {}), updatedAt: new Date().toISOString() };
  const result = await query(
    `UPDATE ${APP_RECORDS_TABLE}
        SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
      WHERE model = $1 AND id = $2
      RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(payload)]
  );
  const record = mapAppRecordRow(result.rows[0]);
  if (!record && throwIfMissing) {
    const error = new Error(`Record not found for model "${model}" and id "${id}"`);
    (error as any).statusCode = 404;
    (error as any).code = "RECORD_NOT_FOUND";
    throw error;
  }
  return record;
}

export default initDB;