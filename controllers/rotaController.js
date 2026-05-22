/**
 * controllers/rotaController.js — Module 5 (Rota & Shift Management) — UPDATED
 *
 * ✅ ALIGNED with CPS_Rota_Management_Specification.docx
 * ✅ Business Rules enforced
 * ✅ Proper model imports
 * ✅ Complete error handling
 * ✅ FIX: getRotaGrid now resolves clinician + practice names from UUIDs
 * ✅ FIX: createBulkShifts now inserts into rota_shifts (not app_records)
 * ✅ FIX: getClinicianRota now uses SQL fetchRotaShifts instead of Mongoose
 */

import nodemailer from "nodemailer";
import { query } from "../config/db.js";
import { logAudit } from "../middleware/auditLogger.js";
import {
  normalizeClinicianId,
  resolveClinicianIdForUser,
} from "../lib/clinicianLink.js";
import { applyCoverShiftDefaults } from "../lib/rotaPracticeEnrich.js";
import {
  SQL_PRACTICE_NAME,
  SQL_CLINICAL_SYSTEM,
  SQL_ROTA_CLINICAL_SYSTEM,
  SQL_PRACTICE_JOINS,
  SQL_ROTA_PRACTICE_JOINS,
} from "../lib/sqlJoins.js";
import { v4 as uuidv4 } from "uuid";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import Shift from "../models/Shift.js";
import RotaDistribution from "../models/RotaDistribution.js";
import Clinician from "../models/Clinician.js";
import ClinicianComplianceDoc from "../models/ClinicianComplianceDoc.js";
import ContactHistory from "../models/ContactHistory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── ID helpers ───────────────────────────────────────────────────────────────
const toMongoId = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toUUID = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return UUID_RE.test(s) ? s : null;
};

const toPracticeId = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
};

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, data, message });

const fail = (res, status, message, data = null) =>
  res.status(status).json({ success: false, data, message });

const parseIntStrict = (value) => {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
};

const computeHours = (startTime, endTime) => {
  if (!startTime || !endTime) return null;
  const start = new Date(`1970-01-01T${startTime}Z`).getTime();
  const end = new Date(`1970-01-01T${endTime}Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const diff = (end - start) / 3_600_000;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return Math.round(diff * 100) / 100;
};

const isExpired = (doc) => {
  if (!doc?.expiryDate) return false;
  return new Date(doc.expiryDate).getTime() < Date.now();
};

const REQUIRED_COMPLIANCE = [
  { label: "DPA", match: /data\s*protection|dpa/i },
  { label: "NDA", match: /non[-\s]*disclosure|nda/i },
  { label: "Indemnity", match: /indemnity/i },
  { label: "DBS", match: /dbs/i },
  { label: "GPhC", match: /gphc/i },
  { label: "Mandatory Training", match: /mandatory\s*training/i },
];

export async function checkRestrictedClinician(clinicianId, practiceId) {
  const clinician = toUUID(clinicianId);
  const practice = toUUID(practiceId);

  if (!clinician || !practice) return { blocked: false, reason: "" };

  const result = await query(
    `SELECT *
       FROM restricted_clinicians
      WHERE clinician_id = $1
        AND entity_type IN ('practice', 'surgery')
        AND entity_id = $2
        AND is_active = true
      LIMIT 1`,
    [clinician, practice]
  );
  const record = result.rows[0];

  if (record) {
    return {
      blocked: true,
      reason: record.reason || "Clinician is restricted at this surgery",
      record,
    };
  }
  return { blocked: false, reason: "" };
}

export async function checkMandatoryCompliance(clinicianId) {
  const id = toMongoId(clinicianId);
  if (!id) {
    const err = new Error("Invalid clinician id");
    err.statusCode = 400;
    throw err;
  }

  const docs = await ClinicianComplianceDoc.find({ clinician: id }).lean();
  const approved = docs.filter((d) => d.status === "approved" && !isExpired(d));

  const missing = [];
  for (const req of REQUIRED_COMPLIANCE) {
    const found = approved.some((d) => {
      const key = String(d.docKey || "");
      const name = String(d.docName || "");
      return req.match.test(key) || req.match.test(name);
    });
    if (!found) missing.push(req.label);
  }

  return { passed: missing.length === 0, missing };
}

export function validateCoverEntry(entry = {}) {
  const isCover = entry.is_cover === true || entry.is_cover === "true";

  if (isCover) {
    if (String(entry.project_code || "").trim() !== "COVER") {
      const err = new Error("Cover shifts must use project_code = COVER");
      err.statusCode = 400;
      throw err;
    }
    const service = String(entry.service_code || "").toUpperCase();
    if (!["PCN", "GP", "EA"].includes(service)) {
      const err = new Error("Cover shifts must use service_code PCN | GP | EA");
      err.statusCode = 400;
      throw err;
    }
  }

  const status = String(entry.status || "").toLowerCase();
  const allowed = ["working", "annual_leave", "sick", "cppe", "cover", "gap", "cancelled"];
  if (!allowed.includes(status)) {
    const err = new Error(`Invalid shift status: "${status}"`);
    err.statusCode = 400;
    throw err;
  }

  if (status === "cover" && !isCover) {
    const err = new Error("status=cover requires is_cover=true");
    err.statusCode = 400;
    throw err;
  }

  if (status === "gap" && entry.clinician_id) {
    const err = new Error("Gap shifts must not have a clinician_id");
    err.statusCode = 400;
    throw err;
  }
}

export const checkRestrictedClinicianEntry = async (req, res, next) => {
  try {
    const clinicianId = toUUID(req.query.clinicianId);
    const practiceId = toUUID(req.query.practiceId);
    if (!clinicianId || !practiceId)
      return fail(res, 400, "clinicianId and practiceId are required");
    const result = await checkRestrictedClinician(clinicianId, practiceId);
    return ok(res, result, "Restricted clinician check");
  } catch (err) {
    next(err);
  }
};

export const checkMandatoryComplianceEntry = async (req, res, next) => {
  try {
    const clinicianId = toMongoId(req.query.clinicianId);
    if (!clinicianId) return fail(res, 400, "clinicianId is required");
    const result = await checkMandatoryCompliance(clinicianId);
    return ok(res, result, "Compliance check");
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

function buildRotaEmailHTML(rotaData, month, year) {
  const title = `Rota for ${String(month).padStart(2, "0")}/${year}`;
  const rows = Array.isArray(rotaData) ? rotaData : [];
  const bodyRows = rows
    .map((s) => `
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${String(s.date || "").slice(0, 10)}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.start_time || ""} - ${s.end_time || ""}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.status || ""}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.practice_name || s.practice_id || ""}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.clinician_name || s.clinician_id || ""}</td>
    </tr>
  `)
    .join("\n");

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;">
      <h2 style="margin:0 0 10px;">${title}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">Generated by CPS Intranet.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr>
          <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Date</th>
          <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Time</th>
          <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Status</th>
          <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Practice</th>
          <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Clinician</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseIntStrict(process.env.EMAIL_PORT) ?? 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const monthRange = (month, year) => {
  const m = parseIntStrict(month);
  const y = parseIntStrict(year);
  if (!m || !y || m < 1 || m > 12) return null;
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
};

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));

const normalizeTime = (t) => {
  if (!t) return null;
  const s = String(t).trim();
  if (!s) return null;
  return s.length === 5 ? `${s}:00` : s;
};

const ROTA_STATUSES = new Set(["working", "annual_leave", "sick", "cppe", "gap", "cover", "cancelled"]);
const SERVICE_CODES = new Set(["PCN", "GP", "EA"]);

const calcRotaEntryHours = (shiftStart, shiftEnd) => {
  const [startH, startM] = String(shiftStart || "").split(":").map(Number);
  const [endH, endM] = String(shiftEnd || "").split(":").map(Number);
  if (![startH, startM, endH, endM].every(Number.isFinite)) return null;
  const total = ((endH * 60 + endM) - (startH * 60 + startM)) / 60;
  return total > 0 ? Math.round(total * 100) / 100 : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIXED: createBulkShifts — now inserts into rota_shifts (not app_records)
// ─────────────────────────────────────────────────────────────────────────────
export const createBulkShifts = async (req, res, next) => {
  try {
    const {
      clinician_id,
      clinician_name,
      practice_id,
      practice_name,
      pcn_id,
      date_from,
      date_to,
      days_of_week = [1, 2, 3, 4, 5],
      shift_start = "09:00",
      shift_end = "17:00",
      hourly_rate,
      status = "working",
      clinical_system,
      service_code,
      notes = "",
    } = req.body;

    if (!practice_id || !date_from || !date_to) {
      return fail(res, 400, "practice_id, date_from, and date_to are required");
    }

    const finalStatus = String(status || "working").toLowerCase();
    if (!ROTA_STATUSES.has(finalStatus)) {
      return fail(res, 400, "Invalid rota status");
    }

    const finalServiceCode = service_code
      ? String(service_code).toUpperCase()
      : null;
    if (finalServiceCode && !SERVICE_CODES.has(finalServiceCode)) {
      return fail(res, 400, "Invalid service_code");
    }

    const total_hours = calcRotaEntryHours(shift_start, shift_end);
    if (!total_hours) {
      return fail(res, 400, "shift_end must be after shift_start");
    }

    const rate =
      hourly_rate !== undefined && hourly_rate !== null && hourly_rate !== ""
        ? Number(hourly_rate)
        : null;
    const total_cost =
      rate !== null
        ? Math.round(total_hours * rate * 100) / 100
        : null;

    const selectedDays = new Set(
      (Array.isArray(days_of_week) ? days_of_week : [1, 2, 3, 4, 5]).map(
        (day) => Number(day)
      )
    );

    const userId = String(req.user._id || req.user.id);
    const created = [];
    const current = new Date(`${date_from}T00:00:00Z`);
    const end = new Date(`${date_to}T00:00:00Z`);

    // Parse month/year from date_from for rota_month / rota_year columns
    const rotaMonth = current.getUTCMonth() + 1;
    const rotaYear  = current.getUTCFullYear();

    while (current <= end) {
      const dayOfWeek = current.getUTCDay();

      if (selectedDays.has(dayOfWeek)) {
        const id      = uuidv4();
        const dateStr = current.toISOString().slice(0, 10);

        // ✅ Insert into rota_shifts — only columns that exist in the table
        await query(
          `INSERT INTO rota_shifts (
             id,
             clinician_id,
             surgery_id,
             shift_date,
             shift_type,
             start_time,
             end_time,
             expected_hours,
             is_cover,
             is_filled,
             rota_month,
             rota_year,
             created_by,
             created_at,
             updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12, $13,
             NOW(), NOW()
           )`,
          [
            id,
            finalStatus === "gap" ? null : (clinician_id || null),   // clinician_id
            practice_id,                                               // surgery_id
            dateStr,                                                   // shift_date
            finalStatus,                                               // shift_type
            shift_start,                                               // start_time
            shift_end,                                                 // end_time
            total_hours,                                               // expected_hours
            finalStatus === "cover",                                   // is_cover
            finalStatus === "working",                                 // is_filled
            rotaMonth,                                                 // rota_month
            rotaYear,                                                  // rota_year
            userId,                                                    // created_by
          ]
        );

        created.push({
          id,
          clinician_id:   finalStatus === "gap" ? null : (clinician_id || null),
          clinician_name: finalStatus === "gap" ? null : (clinician_name || null),
          practice_id,
          practice_name:  practice_name || null,
          pcn_id:         pcn_id || null,
          date:           dateStr,
          shift_start,
          shift_end,
          total_hours,
          hourly_rate:    rate,
          total_cost,
          status:         finalStatus,
          clinical_system: clinical_system || null,
          service_code:   finalServiceCode,
          is_cover:       finalStatus === "cover",
          notes:          notes || null,
        });
      }

      current.setUTCDate(current.getUTCDate() + 1);
    }

    return ok(
      res,
      { created_count: created.length, entries: created },
      `${created.length} shifts created successfully`,
      201
    );
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER: Load all clinicians + practices from app_records (PostgreSQL)
   so we can resolve UUID → name for shifts display
   ───────────────────────────────────────────────────────────────────────────── */
async function buildLookupMaps() {
  // Clinicians: id (UUID from app_records) → { fullName, email, clinicianType, contractType }
  const clinicianRows = await query(
    `SELECT id, data FROM app_records WHERE model = 'Clinician'`
  );
  const clinicianMap = new Map();
  for (const row of clinicianRows.rows) {
    const d = row.data || {};
    clinicianMap.set(String(row.id), {
      _id:           String(row.id),
      id:            String(row.id),
      fullName:      d.fullName || d.name || "Unknown Clinician",
      email:         d.email || "",
      clinicianType: d.clinicianType || "",
      contractType:  d.contractType || "",
    });
  }

  // Also load user accounts with clinician role → same UUID resolution
  const userRows = await query(
    `SELECT id, data FROM app_records WHERE model = 'user' AND data->>'role' = 'clinician'`
  );
  for (const row of userRows.rows) {
    if (!clinicianMap.has(String(row.id))) {
      const d = row.data || {};
      clinicianMap.set(String(row.id), {
        _id:      String(row.id),
        id:       String(row.id),
        fullName: d.name || d.fullName || d.email || "Clinician",
        email:    d.email || "",
      });
    }
  }

  // Practices: id (UUID from app_records) → { name, odsCode }
  const practiceRows = await query(
    `SELECT id, data FROM app_records WHERE model = 'practice'`
  );
  const practiceMap = new Map();
  for (const row of practiceRows.rows) {
    const d = row.data || {};
    practiceMap.set(String(row.id), {
      _id:     String(row.id),
      id:      String(row.id),
      name:    d.name || "Unknown Practice",
      odsCode: d.odsCode || "",
    });
  }

  return { clinicianMap, practiceMap };
}

/* ─── GET /api/rota?month=&year= ────────────────────────────────────────── */
export const getRotaGrid = async (req, res, next) => {
  try {
    const range = monthRange(req.query.month, req.query.year);
    if (!range) return fail(res, 400, "month and year are required");

    // ── Load lookup maps for name resolution ──────────────────────────────
    const { clinicianMap, practiceMap } = await buildLookupMaps();

    // ── Fetch all shifts for the month from Supabase ──────────────────────
    const shifts = await Shift.find({
      dateRange: { start: range.startDate, end: range.endDate },
    });

    // ── Enrich each shift with resolved names ─────────────────────────────
    const enrichedShifts = shifts.map((s) => {
      const raw = typeof s.toObject === "function" ? s.toObject() : { ...s };

      // Resolve clinician
      const cId = raw.clinician_id ? String(raw.clinician_id) : null;
      const clinicianRecord = cId ? (clinicianMap.get(cId) ?? null) : null;
      raw.clinician_name = clinicianRecord?.fullName || null;

      // Resolve practice
      const pId = raw.practice_id ? String(raw.practice_id) : null;
      const practiceRecord = pId ? (practiceMap.get(pId) ?? null) : null;
      raw.practice_name = practiceRecord?.name || null;

      return raw;
    });

    // ── Build per-clinician grid ───────────────────────────────────────────
    const allClinicians = Array.from(clinicianMap.values()).sort((a, b) =>
      String(a.fullName).localeCompare(String(b.fullName))
    );

    const byClinician = new Map();

    for (const c of allClinicians) {
      byClinician.set(c._id, { clinician: c, shifts: {} });
    }

    for (const s of enrichedShifts) {
      const cId = s.clinician_id ? String(s.clinician_id) : null;
      const dayKey = String(s.date).slice(0, 10);

      if (!cId || s.status === "gap") {
        const gapKey = `gap_${s.practice_id || "unknown"}`;
        if (!byClinician.has(gapKey)) {
          const practiceName = s.practice_name || s.practice_id || "Unknown Practice";
          byClinician.set(gapKey, {
            clinician: {
              _id:      gapKey,
              id:       gapKey,
              fullName: `⚠ Gap — ${practiceName}`,
              isGapRow: true,
            },
            shifts: {},
          });
        }
        const existing = byClinician.get(gapKey).shifts[dayKey];
        if (!existing) byClinician.get(gapKey).shifts[dayKey] = s;
        continue;
      }

      if (!byClinician.has(cId)) {
        const c = clinicianMap.get(cId) ?? {
          _id:      cId,
          id:       cId,
          fullName: s.clinician_name || cId,
        };
        byClinician.set(cId, { clinician: c, shifts: {} });
      }

      const existing = byClinician.get(cId).shifts[dayKey];
      if (!existing || s.status === "working") {
        byClinician.get(cId).shifts[dayKey] = s;
      }
    }

    const cliniciansWithShifts = Array.from(byClinician.values()).filter(
      (row) => Object.keys(row.shifts).length > 0
    );

    return ok(res, {
      month: parseIntStrict(req.query.month),
      year:  parseIntStrict(req.query.year),
      clinicians:  cliniciansWithShifts,
      totalShifts: shifts.length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/rota/clinician/:id?month=&year= ──────────────────────────────── */
export const getClinicianRota = async (req, res, next) => {
  try {
    // ✅ FIX: Accept BOTH UUID (from app_records) AND MongoDB ID (legacy)
    const clinicianId = toUUID(req.params.id) || toMongoId(req.params.id);
    if (!clinicianId) return fail(res, 400, "Invalid clinician id");

    const month = parseIntStrict(req.query.month);
    const year = parseIntStrict(req.query.year);
    if (!monthRange(month, year)) return fail(res, 400, "month and year are required");

    // ✅ FIX: Fetch from PostgreSQL (app_records) — Clinician model
    let clinician = null;
    if (toUUID(clinicianId)) {
      // UUID format — fetch from app_records Clinician model
      const appRecord = await query(
        `SELECT id, data FROM app_records WHERE model = 'Clinician' AND id = $1 LIMIT 1`,
        [clinicianId]
      );
      if (appRecord.rows[0]) {
        const d = appRecord.rows[0].data || {};
        clinician = {
          id: appRecord.rows[0].id,
          _id: appRecord.rows[0].id,
          fullName: d.fullName || d.name,
          email: d.email,
          clinicianType: d.clinicianType,
          contractType: d.contractType,
        };
      }
    } else {
      // MongoDB format (legacy) — try Mongoose
      try {
        const doc = await Clinician.findById(clinicianId).lean();
        clinician = doc;
      } catch (e) {
        // Continue with null
      }
    }

    if (!clinician) return fail(res, 404, "Clinician not found");

    // ✅ FIX: Fetch shifts from SQL rota_shifts table using fetchRotaShifts helper
    const shifts = await fetchRotaShifts({ month, year, clinicianId });

    return ok(res, {
      clinician,
      month,
      year,
      shifts,
      totalShifts: shifts.length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/generate ───────────────────────────────────────────── */
export const generateMonthlyRota = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.body?.month);
    const year  = parseIntStrict(req.body?.year);
    const range = monthRange(month, year);
    if (!range) return fail(res, 400, "month and year are required");

    await logAudit(req, "ROTA_GENERATE_REQUESTED", "Shift", {
      detail: `Generate rota requested for ${String(month).padStart(2, "0")}/${year}`,
      after: { month, year },
    });

    return ok(res, { month, year, queued: true }, "Rota generation queued", 202);
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/shift ──────────────────────────────────────────────── */
export const createShift = async (req, res, next) => {
  try {
    const practiceId = toPracticeId(req.body?.practice_id);
    if (!practiceId) return fail(res, 400, "practice_id is required");
    if (!req.body?.date) return fail(res, 400, "date is required");

    const payload = {
      clinician_id: toUUID(req.body?.clinician_id) || toMongoId(req.body?.clinician_id) || null,
      practice_id:  practiceId,
      client_id:    toUUID(req.body?.client_id) || null,
      date:         req.body?.date,
      day_of_week:  req.body?.day_of_week || null,
      start_time:   req.body?.start_time || null,
      end_time:     req.body?.end_time || null,
      hours:
        req.body?.hours != null && req.body?.hours !== ""
          ? Number(req.body?.hours)
          : computeHours(req.body?.start_time, req.body?.end_time),
      clinical_system:     req.body?.clinical_system || null,
      status:              String(req.body?.status || "working").toLowerCase(),
      is_cover:            req.body?.is_cover === true || req.body?.is_cover === "true",
      project_code:        req.body?.project_code || null,
      service_code:        req.body?.service_code ? String(req.body?.service_code).toUpperCase() : null,
      original_gap_id:     toUUID(req.body?.original_gap_id) || null,
      cover_reason:        req.body?.cover_reason || null,
      confirmation_received: req.body?.confirmation_received === true || req.body?.confirmation_received === "true",
      access_request_needed: req.body?.access_request_needed === true || req.body?.access_request_needed === "true",
      client_informed:     req.body?.client_informed === true || req.body?.client_informed === "true",
      workstreams_notes:   req.body?.workstreams_notes || null,
      clinician_notified:  req.body?.clinician_notified === true || req.body?.clinician_notified === "true",
      hours_to_cover:
        req.body?.hours_to_cover != null && req.body?.hours_to_cover !== ""
          ? Number(req.body?.hours_to_cover) : null,
      hours_covered:
        req.body?.hours_covered != null && req.body?.hours_covered !== ""
          ? Number(req.body?.hours_covered) : null,
      compliance_checked:         req.body?.compliance_checked === true || req.body?.compliance_checked === "true",
      compliance_override_by:     toUUID(req.body?.compliance_override_by) || null,
      compliance_override_reason: req.body?.compliance_override_reason || null,
      source:         req.body?.source || "manual",
      source_leave_id: toUUID(req.body?.source_leave_id) || null,
      created_by:     toUUID(req.user?._id || req.user?.id) || toMongoId(req.user?._id || req.user?.id) || null,
    };

    const withCover = await applyCoverShiftDefaults(payload, practiceId);
    Object.assign(payload, withCover);
    validateCoverEntry(payload);

    if (payload.clinician_id) {
      const restriction = await checkRestrictedClinician(payload.clinician_id, payload.practice_id);
      if (restriction.blocked) {
        await logAudit(req, "ROTA_BOOKING_BLOCKED_RESTRICTED", "Shift", {
          detail: `Blocked: restricted clinician at practice ${payload.practice_id}`,
          after:  { clinicianId: payload.clinician_id, practiceId: payload.practice_id },
          status: "blocked",
        });
        return fail(res, 403, restriction.reason);
      }

      const compliance = await checkMandatoryCompliance(payload.clinician_id);
      if (!compliance.passed) {
        const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
        if (!canOverride) {
          await logAudit(req, "ROTA_BOOKING_BLOCKED_COMPLIANCE", "Shift", {
            detail: `Blocked: missing compliance (${compliance.missing.join(", ")})`,
            after:  { clinicianId: payload.clinician_id, missing: compliance.missing },
            status: "blocked",
          });
          return fail(res, 409, "Clinician missing mandatory compliance", { missing: compliance.missing });
        }
      }
      payload.compliance_checked = true;
    }

    const shift = await Shift.create(payload);
    try {
      await mirrorShiftToRotaShifts(shift);
    } catch (mirrorErr) {
      console.warn("[createShift] rota_shifts mirror:", mirrorErr.message);
    }

    await logAudit(req, "CREATE_SHIFT", "Shift", {
      resourceId: shift.id,
      detail:     `Created shift (${shift.status}) on ${shift.date}`,
      after:      safeJson(shift),
    });

    return ok(res, shift, "Shift created", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

/* ─── PATCH /api/rota/shift/:id ─────────────────────────────────────────── */
export const updateShift = async (req, res, next) => {
  try {
    const shiftId = toUUID(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid shift id");

    const before = await Shift.findById(shiftId);
    if (!before) return fail(res, 404, "Shift not found");

    const patch = {
      ...(req.body?.clinician_id !== undefined && {
        clinician_id: toUUID(req.body?.clinician_id) || toMongoId(req.body?.clinician_id) || null,
      }),
      ...(req.body?.practice_id !== undefined && { practice_id: toPracticeId(req.body?.practice_id) }),
      ...(req.body?.client_id   !== undefined && { client_id: toUUID(req.body?.client_id) || null }),
      ...(req.body?.date        !== undefined && { date: req.body?.date }),
      ...(req.body?.status      !== undefined && { status: String(req.body?.status).toLowerCase() }),
      ...(req.body?.workstreams_notes !== undefined && { workstreams_notes: req.body?.workstreams_notes }),
    };

    if (patch.clinician_id) {
      const restriction = await checkRestrictedClinician(
        patch.clinician_id,
        patch.practice_id || before.practice_id
      );
      if (restriction.blocked) {
        await logAudit(req, "ROTA_UPDATE_BLOCKED_RESTRICTED", "Shift", {
          resourceId: shiftId,
          detail:     "Blocked update: restricted clinician",
          status:     "blocked",
        });
        return fail(res, 403, restriction.reason);
      }
    }

    const updated = await Shift.findByIdAndUpdate(shiftId, patch);

    await logAudit(req, "UPDATE_SHIFT", "Shift", {
      resourceId: shiftId,
      detail:     `Updated shift ${shiftId}`,
      before:     safeJson(before),
      after:      safeJson(updated),
    });

    return ok(res, updated, "Shift updated");
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

/* ─── DELETE /api/rota/shift/:id ────────────────────────────────────────── */
export const deleteShift = async (req, res, next) => {
  try {
    const shiftId = toUUID(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid shift id");

    const before = await Shift.findById(shiftId);
    if (!before) return fail(res, 404, "Shift not found");

    await Shift.findByIdAndDelete(shiftId);

    await logAudit(req, "DELETE_SHIFT", "Shift", {
      resourceId: shiftId,
      detail:     `Deleted shift ${shiftId}`,
      before:     safeJson(before),
    });

    return ok(res, { id: shiftId }, "Shift deleted");
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/rota/gaps?days=14 ────────────────────────────────────────── */
export const getGapReport = async (req, res, next) => {
  try {
    const days = parseIntStrict(req.query.days) ?? 14;
    const gaps = await Shift.findGapsAhead(days);

    const { practiceMap } = await buildLookupMaps();

    const gapsWithUrgency = gaps.map((g) => {
      const raw = typeof g.toObject === "function" ? g.toObject() : { ...g };
      const gapDate = new Date(`${String(raw.date).slice(0, 10)}T00:00:00Z`).getTime();
      const urgent  = gapDate - Date.now() <= 48 * 3_600_000;

      const pId = raw.practice_id ? String(raw.practice_id) : null;
      raw.practice_name = pId ? (practiceMap.get(pId)?.name ?? raw.practice_id) : raw.practice_id;

      return { ...raw, urgent };
    });

    return ok(res, {
      days,
      gaps:   gapsWithUrgency,
      total:  gapsWithUrgency.length,
      urgent: gapsWithUrgency.filter((g) => g.urgent).length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/cover ──────────────────────────────────────────────── */
export const assignCover = async (req, res, next) => {
  try {
    const gapId      = toUUID(req.body?.gapId || req.body?.original_gap_id);
    const clinicianId = toMongoId(req.body?.clinicianId || req.body?.clinician_id);

    if (!gapId)       return fail(res, 400, "gapId is required");
    if (!clinicianId) return fail(res, 400, "clinicianId is required");

    const gap = await Shift.findById(gapId);
    if (!gap)                  return fail(res, 404, "Gap shift not found");
    if (gap.status !== "gap")  return fail(res, 409, "Shift is not a gap");

    const restriction = await checkRestrictedClinician(clinicianId, gap.practice_id);
    if (restriction.blocked) {
      await logAudit(req, "COVER_ASSIGN_BLOCKED_RESTRICTED", "Shift", {
        detail: "Blocked cover: restricted clinician",
        status: "blocked",
      });
      return fail(res, 403, restriction.reason);
    }

    const compliance = await checkMandatoryCompliance(clinicianId);
    if (!compliance.passed) {
      const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
      if (!canOverride) {
        return fail(res, 409, "Clinician missing mandatory compliance", { missing: compliance.missing });
      }
    }

    const coverPayload = {
      clinician_id:  clinicianId,
      practice_id:   gap.practice_id,
      client_id:     gap.client_id || null,
      date:          gap.date,
      day_of_week:   gap.day_of_week,
      start_time:    req.body?.start_time || gap.start_time,
      end_time:      req.body?.end_time   || gap.end_time,
      hours:
        req.body?.hours != null && req.body?.hours !== ""
          ? Number(req.body?.hours)
          : gap.hours,
      status:      "cover",
      is_cover:    true,
      project_code: "COVER",
      service_code: String(req.body?.service_code || gap.service_code || "PCN").toUpperCase(),
      original_gap_id:   gapId,
      compliance_checked: true,
      source:    "manual",
      created_by: toUUID(req.user?._id || req.user?.id) || null,
    };

    const coverShift = await Shift.create(coverPayload);
    await Shift.findByIdAndUpdate(gapId, { status: "cancelled" });

    await logAudit(req, "ASSIGN_COVER", "Shift", {
      resourceId: coverShift.id,
      detail:     `Assigned cover for gap ${gapId}`,
      after:      safeJson({ gapId, coverShiftId: coverShift.id }),
    });

    return ok(res, { gapId, coverShift }, "Cover assigned", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

/* ─── GET /api/rota/cover-requests ──────────────────────────────────────── */
export const getCoverRequests = async (req, res, next) => {
  try {
    const status      = String(req.query.status || "open").toLowerCase();
    const finalStatus = ["open", "filled", "cancelled"].includes(status) ? status : "open";

    const result = await query(
      `SELECT * FROM cover_requests WHERE status = $1 ORDER BY date ASC`,
      [finalStatus]
    );

    return ok(res, {
      status:   finalStatus,
      requests: result.rows,
      total:    result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/send/:clientId ────────────────────────────────────── */
export const sendRotaToClient = async (req, res, next) => {
  try {
    const clientId   = toPracticeId(req.params.clientId);
    if (!clientId) return fail(res, 400, "Invalid clientId");

    const month      = parseIntStrict(req.body?.month);
    const year       = parseIntStrict(req.body?.year);
    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.filter(Boolean)
      : [];
    const range = monthRange(month, year);

    if (!range)                  return fail(res, 400, "month and year are required");
    if (recipients.length === 0) return fail(res, 400, "recipients are required");

    const shifts = await Shift.find({
      client_id: clientId,
      dateRange: { start: range.startDate, end: range.endDate },
    });

    const html = buildRotaEmailHTML(shifts, month, year);
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to:      recipients.join(","),
      subject: `CPS Rota ${String(month).padStart(2, "0")}/${year}`,
      html,
    });

    const distribution = await RotaDistribution.create({
      client_id:        clientId,
      client_name:      req.body?.client_name || "",
      month,
      year,
      sent_by:          toUUID(req.user?._id || req.user?.id) || null,
      recipient_emails: recipients,
    });

    await logAudit(req, "SEND_ROTA_TO_CLIENT", "RotaDistribution", {
      resourceId: distribution.id,
      detail:     `Sent rota to client ${clientId} for ${String(month).padStart(2, "0")}/${year}`,
      after:      safeJson(distribution),
    });

    await ContactHistory.create({
      entityType: "Client",
      entityId:   String(clientId),
      type:       "email",
      subject:    `Rota sent ${String(month).padStart(2, "0")}/${year}`,
      notes:      `Rota distribution sent to ${recipients.join(", ")}`,
      date:       new Date().toISOString(),
      createdBy:  toUUID(req.user?._id || req.user?.id) || null,
      metadata: {
        timestamp:       new Date().toISOString(),
        sent_by:         req.user?._id || req.user?.id,
        recipient_emails: recipients,
      },
    });

    return ok(res, distribution, "Rota sent");
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/seed-shifts ───────────────────────────────────────── */
export const seedShiftsFromJson = async (req, res, next) => {
  try {
    const seedDataPath = join(__dirname, "../seed-data/shifts.json");
    const rawText      = await readFile(seedDataPath, "utf8");
    const rows         = JSON.parse(rawText);

    const clinicians  = await Clinician.find({}).lean();
    const emailToId   = new Map(
      clinicians
        .filter((c) => c?.email)
        .map((c) => [String(c.email).toLowerCase(), String(c._id || c.id)])
    );

    let inserted = 0, skipped = 0, failed = 0;

    for (const raw of rows) {
      const realKeys = Object.keys(raw || {}).filter((k) => k !== "_comment");
      if (!realKeys.length) continue;

      const practice_id = toPracticeId(raw._practiceOdsCode);
      if (!practice_id || !raw.date) { skipped++; continue; }

      const clinician_id = raw._clinicianEmail
        ? (emailToId.get(String(raw._clinicianEmail).toLowerCase()) ?? null)
        : null;

      const status     = String(raw.status || "working").toLowerCase();
      const start_time = normalizeTime(raw.start_time);

      const existing = await query(
        `SELECT id FROM shifts
         WHERE date = $1 AND practice_id = $2 AND status = $3
           AND COALESCE(start_time::text, '') = COALESCE($4::text, '')
         LIMIT 1`,
        [raw.date, practice_id, status, start_time]
      );

      if (existing.rows?.[0]?.id) { skipped++; continue; }

      const payload = {
        clinician_id:          status === "gap" ? null : clinician_id,
        practice_id,
        date:                  raw.date,
        day_of_week:           raw.day_of_week || null,
        start_time,
        end_time:              normalizeTime(raw.end_time),
        hours:                 raw.hours != null && raw.hours !== "" ? Number(raw.hours) : null,
        clinical_system:       raw.clinical_system || null,
        status,
        is_cover:              raw.is_cover === true || raw.is_cover === "true",
        project_code:          raw.project_code || null,
        service_code:          raw.service_code ? String(raw.service_code).toUpperCase() : null,
        cover_reason:          raw.cover_reason || null,
        confirmation_received: raw.confirmation_received === true || raw.confirmation_received === "true",
        access_request_needed: raw.access_request_needed === true || raw.access_request_needed === "true",
        client_informed:       raw.client_informed === true || raw.client_informed === "true",
        workstreams_notes:     raw.workstreams_notes || null,
        clinician_notified:    raw.clinician_notified === true || raw.clinician_notified === "true",
        hours_to_cover:        raw.hours_to_cover != null && raw.hours_to_cover !== "" ? Number(raw.hours_to_cover) : null,
        hours_covered:         raw.hours_covered  != null && raw.hours_covered  !== "" ? Number(raw.hours_covered)  : null,
        compliance_checked:    raw.compliance_checked === true || raw.compliance_checked === "true",
        source:                raw.source || "manual",
        created_by:            toUUID(req.user?._id || req.user?.id) || null,
      };

      try {
        validateCoverEntry(payload);
        await Shift.create(payload);
        inserted++;
      } catch (e) {
        failed++;
      }
    }

    await logAudit(req, "ROTA_SEED_SHIFTS", "Shift", {
      detail: `Seeded shifts from JSON: ${inserted} inserted, ${skipped} skipped, ${failed} failed`,
      after:  { inserted, skipped, failed },
    });

    return ok(res, { inserted, skipped, failed }, "Shifts seeded");
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/rota/shift/:id ───────────────────────────────────────────── */
export const getRotaById = async (req, res, next) => {
  try {
    const shiftId = toUUID(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid id");
    const shift = await Shift.findById(shiftId);
    if (!shift) return fail(res, 404, "Not found");
    return ok(res, shift, "Shift details");
  } catch (err) {
    next(err);
  }
};

/* ─── Aliases ────────────────────────────────────────────────────────────── */
const currentClinicianId = (req) =>
  normalizeClinicianId(req.user?.clinicianId) ||
  normalizeClinicianId(req.user?.clinician_id);

async function resolveRequestClinicianId(req) {
  let id = currentClinicianId(req);
  if (!id && req.user?.role === "clinician") {
    id = await resolveClinicianIdForUser(req.user);
    if (id) req.user.clinicianId = id;
  }
  return id;
}

const sqlMonthRange = (month, year) => {
  const range = monthRange(month, year);
  if (!range) return null;
  const endInclusive = new Date(`${range.endDate}T00:00:00Z`);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);
  return { ...range, endInclusive: endInclusive.toISOString().slice(0, 10) };
};

const mapRotaShiftRow = (row = {}) => ({
  ...row,
  date: row.shift_date?.toISOString?.().slice(0, 10) || row.shift_date,
  shift_date: row.shift_date?.toISOString?.().slice(0, 10) || row.shift_date,
  status: row.shift_type || row.status,
  shift_type: row.shift_type || row.status,
  practice_id: row.surgery_id || row.practice_id,
  practice_name: row.surgery_name || row.practice_name,
  clinical_system: row.clinical_system || null,
  hourly_rate:
    row.hourly_rate != null && row.hourly_rate !== ""
      ? Number(row.hourly_rate)
      : null,
  rate:
    row.hourly_rate != null && row.hourly_rate !== ""
      ? Number(row.hourly_rate)
      : row.rate != null
      ? Number(row.rate)
      : null,
  total_hours: row.expected_hours != null ? Number(row.expected_hours) : row.hours != null ? Number(row.hours) : null,
  hours: row.expected_hours != null ? Number(row.expected_hours) : row.hours != null ? Number(row.hours) : null,
});

const mapShiftTableRow = (row = {}) => {
  const shiftDate = row.date?.toISOString?.().slice(0, 10) || row.date;
  const status = String(row.status || "working").toLowerCase();
  const hours = row.hours != null ? Number(row.hours) : null;
  return mapRotaShiftRow({
    id: row.id,
    clinician_id: row.clinician_id,
    surgery_id: row.practice_id,
    shift_date: shiftDate,
    shift_type: status === "cppe" ? "cppe_training" : status,
    status,
    start_time: row.start_time,
    end_time: row.end_time,
    expected_hours: hours,
    hours,
    is_cover: row.is_cover,
    is_filled: status === "working" && !!row.clinician_id,
    clinician_name: row.clinician_name,
    surgery_name: row.practice_name,
    practice_name: row.practice_name,
    pcn_name: row.pcn_name,
    source: "shifts",
  });
};

const shiftDedupeKey = (shift) =>
  [
    String(shift.shift_date || shift.date || "").slice(0, 10),
    String(shift.clinician_id || ""),
    String(shift.surgery_id || shift.practice_id || ""),
    String(shift.shift_type || shift.status || ""),
  ].join("|");

const mergeShiftLists = (primary, secondary) => {
  const seen = new Set(primary.map(shiftDedupeKey));
  const merged = [...primary];
  for (const shift of secondary) {
    const key = shiftDedupeKey(shift);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(shift);
  }
  return merged.sort((a, b) =>
    String(a.shift_date || "").localeCompare(String(b.shift_date || ""))
  );
};

const fetchRotaShiftsFromRotaTable = async ({ month, year, clinicianId, range }) => {
  const params = [month, year, range.startDate, range.endInclusive];
  let clinicianFilter = "";
  if (clinicianId) {
    params.push(clinicianId);
    clinicianFilter = ` AND TRIM(rs.clinician_id::text) = TRIM($${params.length}::text)`;
  }
  const result = await query(
    `SELECT rs.*,
            COALESCE(c.full_name, cr.data->>'fullName', cr.data->>'name', c.email) AS clinician_name,
            NULLIF(TRIM(COALESCE(p.name, pr.data->>'name', pr.data->>'practiceName', cl.data->>'name')), '') AS surgery_name,
            NULLIF(TRIM(COALESCE(pr.data->>'clinicalSystem', pr.data->>'system', cl.data->>'clinicalSystem', cl.data->>'system')), '') AS clinical_system,
            pc.name AS pcn_name
       FROM rota_shifts rs
       LEFT JOIN clinicians c ON c.id::text = rs.clinician_id::text
       LEFT JOIN app_records cr ON cr.model = 'Clinician' AND cr.id = rs.clinician_id::text
       LEFT JOIN practices p ON p.id::text = rs.surgery_id::text
       LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = rs.surgery_id::text
       LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = rs.surgery_id::text
       LEFT JOIN pcns pc ON pc.id = p.pcn_id
      WHERE (
              (rs.rota_month = $1 AND rs.rota_year = $2)
           OR (rs.shift_date >= $3::date AND rs.shift_date <= $4::date)
            )${clinicianFilter}
      ORDER BY rs.shift_date ASC, clinician_name ASC`,
    params
  );
  return result.rows.map(mapRotaShiftRow);
};

const fetchRotaShiftsFromShiftsTable = async ({ clinicianId, range }) => {
  const params = [range.startDate, range.endDate];
  let clinicianFilter = "";
  if (clinicianId) {
    params.push(clinicianId);
    clinicianFilter = ` AND TRIM(COALESCE(s.clinician_id::text, '')) = TRIM($${params.length}::text)`;
  } else {
    clinicianFilter = ` AND COALESCE(s.clinician_id::text, '') <> ''`;
  }

  const result = await query(
    `SELECT s.*,
            COALESCE(c.full_name, cr.data->>'fullName', cr.data->>'name') AS clinician_name,
            NULLIF(TRIM(COALESCE(p.name, pr.data->>'name', pr.data->>'practiceName', cl.data->>'name')), '') AS practice_name,
            NULLIF(TRIM(COALESCE(s.clinical_system, pr.data->>'clinicalSystem', pr.data->>'system', cl.data->>'clinicalSystem')), '') AS clinical_system,
            pc.name AS pcn_name
       FROM shifts s
       LEFT JOIN clinicians c ON c.id::text = s.clinician_id::text
       LEFT JOIN app_records cr ON cr.model = 'Clinician' AND cr.id = s.clinician_id::text
       LEFT JOIN practices p ON p.id::text = s.practice_id::text
       LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id = s.practice_id::text
       LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id = s.practice_id::text
       LEFT JOIN pcns pc ON pc.id = p.pcn_id
      WHERE s.date >= $1::date
        AND s.date < $2::date
        AND s.status <> 'cancelled'${clinicianFilter}
      ORDER BY s.date ASC`,
    params
  );
  return result.rows.map(mapShiftTableRow);
};

/** Admin rota grid uses `shifts`; clinician portal used only `rota_shifts` — merge both. */
const fetchRotaShifts = async ({ month, year, clinicianId = null }) => {
  const range = sqlMonthRange(month, year);
  if (!range) return [];

  const fromRota = await fetchRotaShiftsFromRotaTable({ month, year, clinicianId, range });
  const fromShifts = await fetchRotaShiftsFromShiftsTable({ clinicianId, range });
  return mergeShiftLists(fromRota, fromShifts);
};

const fetchAllRotaShiftsFromRotaTable = async (clinicianId) => {
  const params = [];
  let clinicianFilter = "";
  if (clinicianId) {
    params.push(clinicianId);
    clinicianFilter = ` AND TRIM(rs.clinician_id::text) = TRIM($${params.length}::text)`;
  }
  const result = await query(
    `SELECT rs.*,
            COALESCE(c.full_name, cr.data->>'fullName', cr.data->>'name', c.email) AS clinician_name,
            ${SQL_PRACTICE_NAME} AS surgery_name,
            ${SQL_ROTA_CLINICAL_SYSTEM} AS clinical_system,
            pc.name AS pcn_name
       FROM rota_shifts rs
       LEFT JOIN clinicians c ON c.id::text = rs.clinician_id::text
       LEFT JOIN app_records cr ON cr.model = 'Clinician' AND cr.id = rs.clinician_id::text
       ${SQL_ROTA_PRACTICE_JOINS("rs.surgery_id")}
       LEFT JOIN pcns pc ON pc.id = p.pcn_id
      WHERE 1=1${clinicianFilter}
      ORDER BY rs.shift_date ASC`,
    params
  );
  return result.rows.map(mapRotaShiftRow);
};

const fetchAllRotaShiftsFromShiftsTable = async (clinicianId) => {
  const params = [];
  let clinicianFilter = "";
  if (clinicianId) {
    params.push(clinicianId);
    clinicianFilter = ` AND TRIM(COALESCE(s.clinician_id::text, '')) = TRIM($${params.length}::text)`;
  } else {
    clinicianFilter = ` AND COALESCE(s.clinician_id::text, '') <> ''`;
  }
  const result = await query(
    `SELECT s.*,
            COALESCE(c.full_name, cr.data->>'fullName', cr.data->>'name') AS clinician_name,
            NULLIF(TRIM(COALESCE(p.name, pr.data->>'name', pr.data->>'practiceName', cl.data->>'name')), '') AS practice_name,
            NULLIF(TRIM(COALESCE(s.clinical_system, pr.data->>'clinicalSystem', cl.data->>'clinicalSystem')), '') AS clinical_system,
            pc.name AS pcn_name
       FROM shifts s
       LEFT JOIN clinicians c ON c.id::text = s.clinician_id::text
       LEFT JOIN app_records cr ON cr.model = 'Clinician' AND cr.id = s.clinician_id::text
       LEFT JOIN practices p ON p.id::text = s.practice_id::text
       LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id = s.practice_id::text
       LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id = s.practice_id::text
       LEFT JOIN pcns pc ON pc.id = p.pcn_id
      WHERE s.status <> 'cancelled'${clinicianFilter}
      ORDER BY s.date ASC`,
    params
  );
  return result.rows.map(mapShiftTableRow);
};

/** All assigned shifts for a clinician (no month/year cap). */
const fetchAllRotaShiftsForClinician = async (clinicianId) => {
  const id = normalizeClinicianId(clinicianId);
  if (!id) return [];
  const fromRota = await fetchAllRotaShiftsFromRotaTable(id);
  const fromShifts = await fetchAllRotaShiftsFromShiftsTable(id);
  return mergeShiftLists(fromRota, fromShifts);
};

/** Mirror a `shifts` row into `rota_shifts` so clinician portal always sees admin bookings. */
async function mirrorShiftToRotaShifts(shift) {
  if (!shift?.date || !shift?.practice_id) return;
  const clinicianId = shift.clinician_id || null;
  const dateStr = String(shift.date).slice(0, 10);
  const [y, m] = dateStr.split("-").map(Number);
  const shiftType = String(shift.status || "working").toLowerCase();
  const mappedType = shiftType === "cppe" ? "cppe_training" : shiftType;
  const hours = shift.hours ?? computeHours(shift.start_time, shift.end_time);

  try {
    await query(
      `INSERT INTO rota_shifts (
         id, clinician_id, surgery_id, shift_date, shift_type,
         start_time, end_time, expected_hours, is_cover, is_filled,
         rota_month, rota_year, created_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         clinician_id = EXCLUDED.clinician_id,
         surgery_id = EXCLUDED.surgery_id,
         shift_date = EXCLUDED.shift_date,
         shift_type = EXCLUDED.shift_type,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         expected_hours = EXCLUDED.expected_hours,
         is_cover = EXCLUDED.is_cover,
         is_filled = EXCLUDED.is_filled,
         rota_month = EXCLUDED.rota_month,
         rota_year = EXCLUDED.rota_year,
         updated_at = NOW()`,
      [
        shift.id,
        clinicianId,
        shift.practice_id,
        dateStr,
        mappedType,
        shift.start_time || null,
        shift.end_time || null,
        hours,
        !!shift.is_cover || shiftType === "cover",
        shiftType === "working" && !!clinicianId,
        m,
        y,
        shift.created_by || null,
      ]
    );
  } catch (err) {
    await query(
      `INSERT INTO rota_shifts (
         id, clinician_id, surgery_id, shift_date, shift_type,
         start_time, end_time, expected_hours, is_cover, is_filled,
         rota_month, rota_year, created_by, created_at, updated_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM rota_shifts rs
          WHERE TRIM(COALESCE(rs.clinician_id::text, '')) = TRIM(COALESCE($2::text, ''))
            AND rs.shift_date = $4::date
            AND TRIM(COALESCE(rs.surgery_id::text, '')) = TRIM(COALESCE($3::text, ''))
            AND rs.shift_type = $5
       )`,
      [
        shift.id,
        clinicianId,
        shift.practice_id,
        dateStr,
        mappedType,
        shift.start_time || null,
        shift.end_time || null,
        hours,
        !!shift.is_cover || shiftType === "cover",
        shiftType === "working" && !!clinicianId,
        m,
        y,
        shift.created_by || null,
      ]
    );
  }
}

const getTimesheetEntries = async (timesheetId) => {
  const result = await query(
    `SELECT te.*,
            NULLIF(TRIM(COALESCE(p.name, pr.data->>'name', cl.data->>'name')), '') AS surgery_name,
            CASE WHEN te.actual_hours IS NULL OR te.expected_hours IS NULL
              THEN NULL ELSE ROUND((te.actual_hours - te.expected_hours)::numeric, 2)
            END AS difference
       FROM timesheet_entries te
       LEFT JOIN practices p ON p.id::text = te.surgery_id::text
       LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = te.surgery_id::text
       LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = te.surgery_id::text
      WHERE te.timesheet_id = $1
      ORDER BY te.shift_date ASC`,
    [timesheetId]
  );
  return result.rows;
};

const refreshTimesheetTotal = async (timesheetId) => {
  const result = await query(
    `UPDATE timesheets
        SET total_hours = COALESCE((
              SELECT ROUND(SUM(COALESCE(actual_hours, 0))::numeric, 2)
                FROM timesheet_entries
               WHERE timesheet_id = $1
            ), 0),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [timesheetId]
  );
  return result.rows[0];
};

const ensureTimesheetEntries = async (timesheet, month, year) => {
  const range = sqlMonthRange(month, year);
  if (!range) return;

  const clinicianId = normalizeClinicianId(timesheet.clinician_id);
  const shifts = await fetchRotaShifts({ month, year, clinicianId });
  const working = shifts.filter((s) => {
    const st = String(s.shift_type || s.status || "").toLowerCase();
    return st === "working" || st === "cover";
  });

  for (const shift of working) {
    const surgeryId = shift.surgery_id || shift.practice_id || null;
    const shiftDate = shift.shift_date || shift.date;
    const expectedHours = shift.expected_hours ?? shift.hours ?? null;
    const isCover = !!shift.is_cover || String(shift.shift_type || shift.status) === "cover";

    await query(
      `INSERT INTO timesheet_entries (
         timesheet_id, clinician_id, surgery_id, shift_date, expected_hours,
         is_cover, project_code, service_code
       )
       SELECT $1, $2, $3, $4, $5, $6,
              CASE WHEN $6 THEN 'COVER' ELSE NULL END,
              NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM timesheet_entries te
          WHERE te.timesheet_id = $1
            AND TRIM(te.clinician_id::text) = TRIM($2::text)
            AND te.shift_date = $4::date
            AND COALESCE(te.surgery_id::text, '') = COALESCE($3::text, '')
       )`,
      [
        timesheet.id,
        clinicianId,
        surgeryId,
        shiftDate,
        expectedHours,
        isCover,
      ]
    );
  }
};

export const getMonthlyRota = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.query.month);
    const year = parseIntStrict(req.query.year);
    if (!monthRange(month, year)) return fail(res, 400, "month and year are required");
    const clinicianId =
      req.user?.role === "clinician" ? await resolveRequestClinicianId(req) : null;
    const shifts = await fetchRotaShifts({ month, year, clinicianId });
    const clinicians = new Map();
    for (const shift of shifts) {
      const key = String(shift.clinician_id);
      if (!clinicians.has(key)) {
        clinicians.set(key, {
          clinician: { id: key, _id: key, fullName: shift.clinician_name || "Clinician", name: shift.clinician_name || "Clinician" },
          shifts: {},
        });
      }
      clinicians.get(key).shifts[shift.shift_date] = shift;
    }
    return ok(res, { month, year, shifts, clinicians: Array.from(clinicians.values()) });
  } catch (err) {
    next(err);
  }
};

export const generateMonthlyRotaFromPatterns = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.body?.month || req.query?.month || req.params?.month);
    const year = parseIntStrict(req.body?.year || req.query?.year || req.params?.year);
    const range = sqlMonthRange(month, year);
    if (!range) return fail(res, 400, "month and year are required");
    const patterns = await query(
      `SELECT * FROM base_patterns
        WHERE is_active = true
          AND effective_from <= $1
          AND (effective_to IS NULL OR effective_to >= $2)
        ORDER BY clinician_id, day_of_week`,
      [range.endInclusive, range.startDate]
    );
    let created = 0;
    let skipped = 0;
    const userId = toUUID(req.user?._id || req.user?.id);
    for (const pattern of patterns.rows) {
      const cursor = new Date(`${range.startDate}T00:00:00Z`);
      const end = new Date(`${range.endInclusive}T00:00:00Z`);
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        if (cursor.getUTCDay() === Number(pattern.day_of_week)) {
          const leave = await query(
            `SELECT id FROM clinician_leave_entries
              WHERE clinician_id = $1 AND approved = true
                AND start_date <= $2 AND end_date >= $2
              LIMIT 1`,
            [pattern.clinician_id, date]
          );
          const restriction = await checkRestrictedClinician(pattern.clinician_id, pattern.surgery_id);
          if (leave.rows[0] || restriction.blocked) {
            skipped++;
          } else {
            const inserted = await query(
              `INSERT INTO rota_shifts (
                 clinician_id, surgery_id, shift_date, shift_type,
                 start_time, end_time, expected_hours, is_filled,
                 rota_month, rota_year, created_by
               )
               VALUES ($1,$2,$3,'working',$4,$5,$6,true,$7,$8,$9)
               ON CONFLICT (clinician_id, surgery_id, shift_date, shift_type) DO NOTHING
               RETURNING id`,
              [pattern.clinician_id, pattern.surgery_id, date, pattern.start_time, pattern.end_time, pattern.expected_hours, month, year, userId]
            );
            if (inserted.rows[0]) created++;
            else skipped++;
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return ok(res, { created, skipped }, "Monthly rota generated", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

export const getRotaGaps = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT rs.*,
              COALESCE(c.full_name, c.email, rs.clinician_id::text) AS clinician_name,
              COALESCE(p.name, rs.surgery_id::text) AS surgery_name
         FROM rota_shifts rs
         LEFT JOIN clinicians c ON c.id = rs.clinician_id
         LEFT JOIN practices p ON p.id = rs.surgery_id
        WHERE rs.is_filled = false
          AND rs.shift_type = 'working'
          AND rs.shift_date >= CURRENT_DATE
          AND rs.shift_date <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY rs.shift_date ASC`
    );
    const gaps = result.rows.map((row) => {
      const shift = mapRotaShiftRow(row);
      const startsAt = new Date(`${shift.shift_date}T${shift.start_time || "00:00:00"}Z`).getTime();
      const hoursUntil = (startsAt - Date.now()) / 3600000;
      return { ...shift, urgency: hoursUntil <= 24 ? "critical" : hoursUntil <= 48 ? "urgent" : "normal", isCritical: hoursUntil <= 24, isUrgent: hoursUntil <= 48 };
    });
    return ok(res, { gaps, total: gaps.length, urgent: gaps.filter((g) => g.urgency === "urgent").length, critical: gaps.filter((g) => g.urgency === "critical").length });
  } catch (err) {
    next(err);
  }
};

export const sendRotaToClients = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.body?.month || req.query?.month);
    const year = parseIntStrict(req.body?.year || req.query?.year);
    if (!monthRange(month, year)) return fail(res, 400, "month and year are required");
    await query(`UPDATE rota_shifts SET sent_to_client = true, updated_at = NOW() WHERE rota_month = $1 AND rota_year = $2`, [month, year]);
    return ok(res, { month, year }, "Rota marked as sent to clients");
  } catch (err) {
    next(err);
  }
};

const isAllScope = (req) =>
  req.query.scope === "all" ||
  req.query.all === "true" ||
  req.query.all === "1";

export const getMyRota = async (req, res, next) => {
  try {
    const clinicianId = await resolveRequestClinicianId(req);
    if (!clinicianId) return fail(res, 403, "Clinician profile is not linked to this user");

    if (isAllScope(req)) {
      const shifts = await fetchAllRotaShiftsForClinician(clinicianId);
      return ok(res, { scope: "all", clinicianId, shifts, total: shifts.length });
    }

    const month = parseIntStrict(req.query.month);
    const year = parseIntStrict(req.query.year);
    if (!monthRange(month, year)) {
      const shifts = await fetchAllRotaShiftsForClinician(clinicianId);
      return ok(res, { scope: "all", clinicianId, shifts, total: shifts.length });
    }

    const shifts = await fetchRotaShifts({ month, year, clinicianId });
    return ok(res, { scope: "month", month, year, clinicianId, shifts, total: shifts.length });
  } catch (err) {
    next(err);
  }
};

export const getTimesheetForMonth = async (req, res, next) => {
  try {
    const clinicianId = await resolveRequestClinicianId(req);
    if (!clinicianId) return fail(res, 403, "Clinician profile is not linked to this user");

    if (isAllScope(req)) {
      const shifts = await fetchAllRotaShiftsForClinician(clinicianId);
      const timesheetsResult = await query(
        `SELECT ts.*,
                COUNT(te.id)::int AS entry_count
           FROM timesheets ts
           LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
          WHERE TRIM(ts.clinician_id::text) = TRIM($1::text)
          GROUP BY ts.id
          ORDER BY ts.year DESC, ts.month DESC`,
        [clinicianId]
      );
      const timeEntriesResult = await query(
        `SELECT te.*,
                COALESCE(p.name, pr.data->>'name', te.surgery_id::text) AS surgery_name
           FROM timesheet_entries te
           LEFT JOIN practices p ON p.id = te.surgery_id
           LEFT JOIN app_records pr ON pr.model = 'practice' AND pr.id = te.surgery_id::text
          WHERE TRIM(te.clinician_id::text) = TRIM($1::text)
          ORDER BY te.shift_date DESC`,
        [clinicianId]
      );
      return ok(res, {
        scope: "all",
        clinicianId,
        shifts,
        timesheets: timesheetsResult.rows,
        entries: timeEntriesResult.rows,
        totalShifts: shifts.length,
      });
    }

    const month = parseIntStrict(req.query.month);
    const year = parseIntStrict(req.query.year);
    if (!monthRange(month, year)) return fail(res, 400, "month and year are required (or use scope=all)");

    const result = await query(
      `INSERT INTO timesheets (clinician_id, month, year)
       VALUES ($1, $2, $3)
       ON CONFLICT (clinician_id, month, year) DO UPDATE SET updated_at = timesheets.updated_at
       RETURNING *`,
      [toUUID(clinicianId) || clinicianId, month, year]
    );
    await ensureTimesheetEntries(result.rows[0], month, year);
    const timesheet = await refreshTimesheetTotal(result.rows[0].id);
    const entries = await getTimesheetEntries(timesheet.id);
    const shifts = await fetchRotaShifts({ month, year, clinicianId });
    return ok(res, { scope: "month", month, year, timesheet, entries, shifts });
  } catch (err) {
    next(err);
  }
};

/** Clinician saves hours for a rota shift → ensure timesheet + entry, then update. */
export const upsertTimesheetEntryForShift = async (req, res, next) => {
  try {
    const clinicianId = await resolveRequestClinicianId(req);
    if (!clinicianId) return fail(res, 403, "Clinician profile is not linked to this user");

    const shiftId = toUUID(req.params.shiftId);
    if (!shiftId) return fail(res, 400, "Invalid shift id");

    let shiftRow = null;
    const fromShifts = await query(`SELECT * FROM shifts WHERE id = $1 LIMIT 1`, [shiftId]);
    if (fromShifts.rows[0]) {
      const s = fromShifts.rows[0];
      shiftRow = {
        clinician_id: s.clinician_id,
        surgery_id: s.practice_id,
        shift_date: s.date?.toISOString?.().slice(0, 10) || s.date,
        expected_hours: s.hours,
        is_cover: s.is_cover,
        start_time: s.start_time,
        end_time: s.end_time,
      };
    } else {
      const fromRota = await query(`SELECT * FROM rota_shifts WHERE id = $1 LIMIT 1`, [shiftId]);
      const r = fromRota.rows[0];
      if (r) {
        shiftRow = {
          clinician_id: r.clinician_id,
          surgery_id: r.surgery_id,
          shift_date: r.shift_date?.toISOString?.().slice(0, 10) || r.shift_date,
          expected_hours: r.expected_hours,
          is_cover: r.is_cover,
          start_time: r.start_time,
          end_time: r.end_time,
        };
      }
    }

    if (!shiftRow) return fail(res, 404, "Shift not found");
    if (String(shiftRow.clinician_id) !== String(clinicianId)) {
      return fail(res, 403, "Cannot update another clinician's shift");
    }

    const dateStr = String(shiftRow.shift_date).slice(0, 10);
    const [y, m] = dateStr.split("-").map(Number);
    const month = parseIntStrict(req.body?.month) || m;
    const year = parseIntStrict(req.body?.year) || y;
    if (!monthRange(month, year)) return fail(res, 400, "Invalid month/year");

    const tsResult = await query(
      `INSERT INTO timesheets (clinician_id, month, year)
       VALUES ($1, $2, $3)
       ON CONFLICT (clinician_id, month, year) DO UPDATE SET updated_at = timesheets.updated_at
       RETURNING *`,
      [toUUID(clinicianId) || clinicianId, month, year]
    );
    const timesheet = tsResult.rows[0];

    const existingEntry = await query(
      `SELECT id FROM timesheet_entries
        WHERE timesheet_id = $1
          AND TRIM(clinician_id::text) = TRIM($2::text)
          AND shift_date = $3::date
          AND COALESCE(surgery_id::text, '') = COALESCE($4::text, '')
        LIMIT 1`,
      [timesheet.id, clinicianId, dateStr, shiftRow.surgery_id || null]
    );

    let entryId = existingEntry.rows[0]?.id;
    if (!entryId) {
      const inserted = await query(
        `INSERT INTO timesheet_entries (
           timesheet_id, clinician_id, surgery_id, shift_date, expected_hours,
           is_cover, project_code, service_code, start_time, end_time
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          timesheet.id,
          clinicianId,
          shiftRow.surgery_id || null,
          dateStr,
          shiftRow.expected_hours,
          !!shiftRow.is_cover,
          shiftRow.is_cover ? "COVER" : null,
          null,
          shiftRow.start_time || null,
          shiftRow.end_time || null,
        ]
      );
      entryId = inserted.rows[0].id;
    }

    const start = normalizeTime(req.body?.start_time ?? shiftRow.start_time);
    const end = normalizeTime(req.body?.end_time ?? shiftRow.end_time);
    const updated = await query(
      `UPDATE timesheet_entries
          SET start_time = $1, end_time = $2, notes = $3,
              actual_hours = $4, updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [start, end, req.body?.notes || null, computeHours(start, end), entryId]
    );
    await refreshTimesheetTotal(timesheet.id);
    const refreshed = await query(`SELECT * FROM timesheets WHERE id = $1`, [timesheet.id]);

    return ok(res, {
      entry: updated.rows[0],
      timesheet: refreshed.rows[0],
    }, "Hours saved for shift");
  } catch (err) {
    next(err);
  }
};

export const updateTimesheetEntry = async (req, res, next) => {
  try {
    const clinicianId = await resolveRequestClinicianId(req);
    const entryId = toUUID(req.params.id);
    if (!entryId) return fail(res, 400, "Invalid entry id");
    const existing = await query(`SELECT * FROM timesheet_entries WHERE id = $1 LIMIT 1`, [entryId]);
    const entry = existing.rows[0];
    if (!entry) return fail(res, 404, "Timesheet entry not found");
    if (String(entry.clinician_id) !== String(clinicianId)) return fail(res, 403, "Cannot update another clinician's timesheet entry");
    const start = normalizeTime(req.body?.start_time);
    const end = normalizeTime(req.body?.end_time);
    const result = await query(
      `UPDATE timesheet_entries
          SET start_time = $1, end_time = $2, notes = $3,
              actual_hours = $4, updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [start, end, req.body?.notes || null, computeHours(start, end), entryId]
    );
    await refreshTimesheetTotal(entry.timesheet_id);
    return ok(res, result.rows[0], "Timesheet entry updated");
  } catch (err) {
    next(err);
  }
};

export const submitTimesheet = async (req, res, next) => {
  try {
    const clinicianId = await resolveRequestClinicianId(req);
    const timesheetId = toUUID(req.params.id);
    const timesheetResult = await query(`SELECT * FROM timesheets WHERE id = $1 LIMIT 1`, [timesheetId]);
    const timesheet = timesheetResult.rows[0];
    if (!timesheet) return fail(res, 404, "Timesheet not found");
    if (String(timesheet.clinician_id) !== String(clinicianId)) return fail(res, 403, "Cannot submit another clinician's timesheet");
    const entries = await getTimesheetEntries(timesheetId);
    const incomplete = entries.filter((entry) => !entry.start_time || !entry.end_time || (entry.is_cover && (entry.project_code !== "COVER" || !entry.service_code)));
    if (incomplete.length) return fail(res, 400, "Timesheet has incomplete entries", { incomplete_entries: incomplete });
    const updated = await query(`UPDATE timesheets SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [timesheetId]);
    return ok(res, { ...updated.rows[0], entries }, "Timesheet submitted");
  } catch (err) {
    next(err);
  }
};

export const getPendingTimesheets = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ts.*,
              COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name,
              COUNT(te.id)::int AS total_entries,
              COALESCE(ROUND(SUM(te.expected_hours)::numeric, 2), 0) AS expected_hours,
              COALESCE(ROUND(SUM(te.actual_hours)::numeric, 2), 0) AS actual_hours
         FROM timesheets ts
         LEFT JOIN clinicians c ON c.id = ts.clinician_id
         LEFT JOIN timesheet_entries te ON te.timesheet_id = ts.id
        WHERE ts.status = 'submitted'
        GROUP BY ts.id, c.full_name, c.email
        ORDER BY ts.submitted_at ASC`
    );
    return ok(res, result.rows);
  } catch (err) {
    next(err);
  }
};

export const getTimesheetDetail = async (req, res, next) => {
  try {
    const timesheetId = toUUID(req.params.id);
    const result = await query(
      `SELECT ts.*, COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name
         FROM timesheets ts
         LEFT JOIN clinicians c ON c.id = ts.clinician_id
        WHERE ts.id = $1 LIMIT 1`,
      [timesheetId]
    );
    if (!result.rows[0]) return fail(res, 404, "Timesheet not found");
    const entries = await getTimesheetEntries(timesheetId);
    return ok(res, { ...result.rows[0], entries });
  } catch (err) {
    next(err);
  }
};

export const getClinicianTimesheetForAdmin = async (req, res, next) => {
  try {
    const clinicianId = toUUID(req.params.clinicianId);
    const month = parseIntStrict(req.query.month);
    const year = parseIntStrict(req.query.year);
    if (!clinicianId) return fail(res, 400, "Invalid clinician id");
    if (!monthRange(month, year)) return fail(res, 400, "month and year are required");

    const result = await query(
      `SELECT ts.*, COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name
         FROM timesheets ts
         LEFT JOIN clinicians c ON c.id = ts.clinician_id
        WHERE ts.clinician_id = $1 AND ts.month = $2 AND ts.year = $3
        LIMIT 1`,
      [clinicianId, month, year]
    );

    if (!result.rows[0]) {
      return ok(res, {
        clinician_id: clinicianId,
        month,
        year,
        status: "draft",
        entries: [],
        history: [],
      }, "No timesheet created for this month yet");
    }

    const entries = await getTimesheetEntries(result.rows[0].id);
    const history = await query(
      `SELECT id, month, year, status, submitted_at, approved_at, rejected_at, rejection_reason, total_hours
         FROM timesheets
        WHERE clinician_id = $1
        ORDER BY year DESC, month DESC`,
      [clinicianId]
    );

    return ok(res, { ...result.rows[0], entries, history: history.rows });
  } catch (err) {
    next(err);
  }
};

export const approveTimesheet = async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE timesheets
          SET status = 'approved', approved_by = $2, approved_at = NOW(),
              invoice_sent = false, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [toUUID(req.params.id), toUUID(req.user?._id || req.user?.id)]
    );
    if (!result.rows[0]) return fail(res, 404, "Timesheet not found");
    return ok(res, result.rows[0], "Timesheet approved");
  } catch (err) {
    next(err);
  }
};

export const rejectTimesheet = async (req, res, next) => {
  try {
    const reason = String(req.body?.rejection_reason || "").trim();
    if (!reason) return fail(res, 400, "rejection_reason is required");
    const result = await query(
      `UPDATE timesheets
          SET status = 'rejected', rejected_by = $2, rejected_at = NOW(),
              rejection_reason = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [toUUID(req.params.id), toUUID(req.user?._id || req.user?.id), reason]
    );
    if (!result.rows[0]) return fail(res, 404, "Timesheet not found");
    return ok(res, result.rows[0], "Timesheet rejected");
  } catch (err) {
    next(err);
  }
};

export const createRota        = createShift;
export const getRota           = getRotaGrid;
export const getRotaByIdAlias  = getRotaById;
export const updateRota        = updateShift;
export const deleteRota        = deleteShift;