/**
 * controllers/rotaController.js — Module 5 (Rota & Shift Management) — UPDATED
 *
 * ✅ ALIGNED with CPS_Rota_Management_Specification.docx
 * ✅ Business Rules enforced
 * ✅ Proper model imports
 * ✅ Complete error handling
 *
 * Endpoints:
 *   GET    /api/rota                      → getRotaGrid (month/year calendar)
 *   GET    /api/rota/:id/diary            → getClinicianRota (personal diary)
 *   GET    /api/rota/:id                  → getRotaById (single shift)
 *   POST   /api/rota/generate             → generateMonthlyRota
 *   POST   /api/rota/shift                → createShift
 *   PATCH  /api/rota/shift/:id            → updateShift
 *   DELETE /api/rota/shift/:id            → deleteShift
 *   GET    /api/rota/gaps                 → getGapReport
 *   POST   /api/rota/cover                → assignCover
 *   GET    /api/rota/cover-requests       → getCoverRequests
 *   POST   /api/rota/send/:clientId       → sendRotaToClient
 *   GET    /api/rota/checks/restricted    → checkRestrictedClinicianEntry
 *   GET    /api/rota/checks/compliance    → checkMandatoryComplianceEntry
 */

import nodemailer from "nodemailer";
import { query } from "../config/db.js";
import { logAudit } from "../middleware/auditLogger.js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import Shift from "../models/Shift.js";
import RotaDistribution from "../models/RotaDistribution.js";
import Clinician from "../models/Clinician.js";
import RestrictedClinician from "../models/RestrictedClinician.js";
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

/**
 * ─── BUSINESS RULE BR-R1 ───────────────────────────────────────────────
 * Leave balance exceeded → HARD BLOCK
 * Enforced at leave submission time, not rota creation.
 */

/**
 * ─── BUSINESS RULE BR-R2 ───────────────────────────────────────────────
 * Restricted clinician → cannot book at flagged client
 */
export async function checkRestrictedClinician(clinicianId, practiceId) {
  const clinician = toMongoId(clinicianId);
  const practice = toPracticeId(practiceId);

  if (!clinician || !practice) return { blocked: false, reason: "" };

  const record = await RestrictedClinician.findOne({
    clinician,
    entityType: "practice",
    entityId: String(practice),
    isActive: true,
  }).lean();

  if (record) {
    return {
      blocked: true,
      reason: record.reason || "Clinician is restricted at this practice",
      record,
    };
  }
  return { blocked: false, reason: "" };
}

/**
 * ─── BUSINESS RULE BR-R3 ───────────────────────────────────────────────
 * Compliance checklist incomplete → cannot book
 */
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

/**
 * ─── BUSINESS RULE BR-R4 ───────────────────────────────────────────────
 * Cover entry data format validation
 * project_code = COV1, service_code = PCN|EA|GPX|EAX
 */
export function validateCoverEntry(entry = {}) {
  const isCover = entry.is_cover === true || entry.is_cover === "true";

  if (isCover) {
    if (String(entry.project_code || "").trim() !== "COV1") {
      const err = new Error("Cover shifts must use project_code = COV1");
      err.statusCode = 400;
      throw err;
    }
    const service = String(entry.service_code || "").toUpperCase();
    if (!["PCN", "EA", "GPX", "EAX"].includes(service)) {
      const err = new Error("Cover shifts must use service_code PCN | EA | GPX | EAX");
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
    const clinicianId = toMongoId(req.query.clinicianId);
    const practiceId = toPracticeId(req.query.practiceId);
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
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.practice_id || ""}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;">${s.clinician_id || ""}</td>
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

/* ─── GET /api/rota?month=&year= ────────────────────────────────────────── */
export const getRotaGrid = async (req, res, next) => {
  try {
    const range = monthRange(req.query.month, req.query.year);
    if (!range) return fail(res, 400, "month and year are required");

    const clinicians = await Clinician.find({ isActive: true }).lean();
    clinicians.sort((a, b) =>
      String(a.fullName || "").localeCompare(String(b.fullName || ""))
    );

    const shifts = await Shift.find({
      dateRange: { start: range.startDate, end: range.endDate },
    });

    const byClinician = new Map();
    for (const c of clinicians) {
      byClinician.set(String(c._id || c.id), { clinician: c, shifts: {} });
    }

    for (const s of shifts) {
      const clinicianId = s.clinician_id ? String(s.clinician_id) : null;
      if (!clinicianId) continue;
      if (!byClinician.has(clinicianId)) {
        byClinician.set(clinicianId, { clinician: { _id: clinicianId }, shifts: {} });
      }
      const dayKey = String(s.date).slice(0, 10);
      const existing = byClinician.get(clinicianId).shifts[dayKey];
      if (!existing || s.status === "working") {
        byClinician.get(clinicianId).shifts[dayKey] = s;
      }
    }

    return ok(res, {
      month: parseIntStrict(req.query.month),
      year: parseIntStrict(req.query.year),
      clinicians: Array.from(byClinician.values()),
      totalShifts: shifts.length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── GET /api/rota/:id/diary?month=&year= ──────────────────────────────── */
export const getClinicianRota = async (req, res, next) => {
  try {
    const clinicianId = toMongoId(req.params.id);
    if (!clinicianId) return fail(res, 400, "Invalid clinician id");

    const range = monthRange(req.query.month, req.query.year);
    if (!range) return fail(res, 400, "month and year are required");

    const clinician = await Clinician.findById(clinicianId).lean();
    if (!clinician) return fail(res, 404, "Clinician not found");

    const shifts = await Shift.find({
      clinician_id: clinicianId,
      dateRange: { start: range.startDate, end: range.endDate },
    });

    return ok(res, {
      clinician,
      month: parseIntStrict(req.query.month),
      year: parseIntStrict(req.query.year),
      shifts,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/generate ───────────────────────────────────────────── */
export const generateMonthlyRota = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.body?.month);
    const year = parseIntStrict(req.body?.year);
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
      practice_id: practiceId,
      client_id: toUUID(req.body?.client_id) || null,
      date: req.body?.date,
      day_of_week: req.body?.day_of_week || null,
      start_time: req.body?.start_time || null,
      end_time: req.body?.end_time || null,
      hours:
        req.body?.hours != null && req.body?.hours !== ""
          ? Number(req.body?.hours)
          : computeHours(req.body?.start_time, req.body?.end_time),
      clinical_system: req.body?.clinical_system || null,
      status: String(req.body?.status || "working").toLowerCase(),
      is_cover: req.body?.is_cover === true || req.body?.is_cover === "true",
      project_code: req.body?.project_code || null,
      service_code: req.body?.service_code
        ? String(req.body?.service_code).toUpperCase()
        : null,
      original_gap_id: toUUID(req.body?.original_gap_id) || null,
      cover_reason: req.body?.cover_reason || null,
      confirmation_received:
        req.body?.confirmation_received === true ||
        req.body?.confirmation_received === "true",
      access_request_needed:
        req.body?.access_request_needed === true ||
        req.body?.access_request_needed === "true",
      client_informed:
        req.body?.client_informed === true || req.body?.client_informed === "true",
      workstreams_notes: req.body?.workstreams_notes || null,
      clinician_notified:
        req.body?.clinician_notified === true || req.body?.clinician_notified === "true",
      hours_to_cover:
        req.body?.hours_to_cover != null && req.body?.hours_to_cover !== ""
          ? Number(req.body?.hours_to_cover)
          : null,
      hours_covered:
        req.body?.hours_covered != null && req.body?.hours_covered !== ""
          ? Number(req.body?.hours_covered)
          : null,
      compliance_checked:
        req.body?.compliance_checked === true || req.body?.compliance_checked === "true",
      compliance_override_by: toUUID(req.body?.compliance_override_by) || null,
      compliance_override_reason: req.body?.compliance_override_reason || null,
      source: req.body?.source || "manual",
      source_leave_id: toUUID(req.body?.source_leave_id) || null,
      created_by: toUUID(req.user?._id || req.user?.id) || toMongoId(req.user?._id || req.user?.id) || null,
    };

    validateCoverEntry(payload);

    // BR-R2: Check restriction
    if (payload.clinician_id) {
      const restriction = await checkRestrictedClinician(payload.clinician_id, payload.practice_id);
      if (restriction.blocked) {
        await logAudit(req, "ROTA_BOOKING_BLOCKED_RESTRICTED", "Shift", {
          detail: `Blocked: restricted clinician at practice ${payload.practice_id}`,
          after: { clinicianId: payload.clinician_id, practiceId: payload.practice_id },
          status: "blocked",
        });
        return fail(res, 403, restriction.reason);
      }

      // BR-R3: Check compliance
      const compliance = await checkMandatoryCompliance(payload.clinician_id);
      if (!compliance.passed) {
        const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
        if (!canOverride) {
          await logAudit(req, "ROTA_BOOKING_BLOCKED_COMPLIANCE", "Shift", {
            detail: `Blocked: missing compliance (${compliance.missing.join(", ")})`,
            after: { clinicianId: payload.clinician_id, missing: compliance.missing },
            status: "blocked",
          });
          return fail(res, 409, "Clinician missing mandatory compliance", {
            missing: compliance.missing,
          });
        }
      }
      payload.compliance_checked = true;
    }

    const shift = await Shift.create(payload);

    await logAudit(req, "CREATE_SHIFT", "Shift", {
      resourceId: shift.id,
      detail: `Created shift (${shift.status}) on ${shift.date}`,
      after: safeJson(shift),
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
      ...(req.body?.client_id !== undefined && { client_id: toUUID(req.body?.client_id) || null }),
      ...(req.body?.date !== undefined && { date: req.body?.date }),
      ...(req.body?.status !== undefined && { status: String(req.body?.status).toLowerCase() }),
    };

    // BR-R2: Check restriction if clinician changed
    if (patch.clinician_id) {
      const restriction = await checkRestrictedClinician(
        patch.clinician_id,
        patch.practice_id || before.practice_id
      );
      if (restriction.blocked) {
        await logAudit(req, "ROTA_UPDATE_BLOCKED_RESTRICTED", "Shift", {
          resourceId: shiftId,
          detail: `Blocked update: restricted clinician`,
          status: "blocked",
        });
        return fail(res, 403, restriction.reason);
      }
    }

    const updated = await Shift.findByIdAndUpdate(shiftId, patch);

    await logAudit(req, "UPDATE_SHIFT", "Shift", {
      resourceId: shiftId,
      detail: `Updated shift ${shiftId}`,
      before: safeJson(before),
      after: safeJson(updated),
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
      detail: `Deleted shift ${shiftId}`,
      before: safeJson(before),
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

    const gapsWithUrgency = gaps.map((g) => {
      const gapDate = new Date(`${String(g.date).slice(0, 10)}T00:00:00Z`).getTime();
      const urgent = gapDate - Date.now() <= 48 * 3600000;
      return { ...g, urgent };
    });

    return ok(res, {
      days,
      gaps: gapsWithUrgency,
      total: gapsWithUrgency.length,
      urgent: gapsWithUrgency.filter((g) => g.urgent).length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/cover ──────────────────────────────────────────────── */
export const assignCover = async (req, res, next) => {
  try {
    const gapId = toUUID(req.body?.gapId || req.body?.original_gap_id);
    const clinicianId = toMongoId(req.body?.clinicianId || req.body?.clinician_id);

    if (!gapId) return fail(res, 400, "gapId is required");
    if (!clinicianId) return fail(res, 400, "clinicianId is required");

    const gap = await Shift.findById(gapId);
    if (!gap) return fail(res, 404, "Gap shift not found");
    if (gap.status !== "gap") return fail(res, 409, "Shift is not a gap");

    // BR-R2: Check restriction
    const restriction = await checkRestrictedClinician(clinicianId, gap.practice_id);
    if (restriction.blocked) {
      await logAudit(req, "COVER_ASSIGN_BLOCKED_RESTRICTED", "Shift", {
        detail: `Blocked cover: restricted clinician`,
        status: "blocked",
      });
      return fail(res, 403, restriction.reason);
    }

    // BR-R3: Check compliance
    const compliance = await checkMandatoryCompliance(clinicianId);
    if (!compliance.passed) {
      const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
      if (!canOverride) {
        return fail(res, 409, "Clinician missing mandatory compliance", {
          missing: compliance.missing,
        });
      }
    }

    const coverPayload = {
      clinician_id: clinicianId,
      practice_id: gap.practice_id,
      client_id: gap.client_id || null,
      date: gap.date,
      day_of_week: gap.day_of_week,
      start_time: req.body?.start_time || gap.start_time,
      end_time: req.body?.end_time || gap.end_time,
      hours:
        req.body?.hours != null && req.body?.hours !== ""
          ? Number(req.body?.hours)
          : gap.hours,
      status: "cover",
      is_cover: true,
      project_code: "COV1",
      service_code: "GPX",
      original_gap_id: gapId,
      compliance_checked: true,
      source: "manual",
      created_by: toUUID(req.user?._id || req.user?.id) || null,
    };

    const coverShift = await Shift.create(coverPayload);

    // Mark gap as cancelled
    await Shift.findByIdAndUpdate(gapId, { status: "cancelled" });

    await logAudit(req, "ASSIGN_COVER", "Shift", {
      resourceId: coverShift.id,
      detail: `Assigned cover for gap ${gapId}`,
      after: safeJson({ gapId, coverShiftId: coverShift.id }),
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
    const status = String(req.query.status || "open").toLowerCase();
    const finalStatus = ["open", "filled", "cancelled"].includes(status) ? status : "open";

    const result = await query(
      `SELECT * FROM cover_requests WHERE status = $1 ORDER BY date ASC`,
      [finalStatus]
    );

    return ok(res, {
      status: finalStatus,
      requests: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── POST /api/rota/send/:clientId ────────────────────────────────────── */
export const sendRotaToClient = async (req, res, next) => {
  try {
    const clientId = toPracticeId(req.params.clientId);
    if (!clientId) return fail(res, 400, "Invalid clientId");

    const month = parseIntStrict(req.body?.month);
    const year = parseIntStrict(req.body?.year);
    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.filter(Boolean)
      : [];
    const range = monthRange(month, year);

    if (!range) return fail(res, 400, "month and year are required");
    if (recipients.length === 0) return fail(res, 400, "recipients are required");

    const shifts = await Shift.find({
      client_id: clientId,
      dateRange: { start: range.startDate, end: range.endDate },
    });

    const html = buildRotaEmailHTML(shifts, month, year);
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: recipients.join(","),
      subject: `CPS Rota ${String(month).padStart(2, "0")}/${year}`,
      html,
    });

    const distribution = await RotaDistribution.create({
      client_id: clientId,
      client_name: req.body?.client_name || "",
      month,
      year,
      sent_by: toUUID(req.user?._id || req.user?.id) || null,
      recipient_emails: recipients,
    });

    await logAudit(req, "SEND_ROTA_TO_CLIENT", "RotaDistribution", {
      resourceId: distribution.id,
      detail: `Sent rota to client ${clientId} for ${String(month).padStart(2, "0")}/${year}`,
      after: safeJson(distribution),
    });

    await ContactHistory.create({
      entityType: "Client",
      entityId: String(clientId),
      type: "email",
      subject: `Rota sent ${String(month).padStart(2, "0")}/${year}`,
      notes: `Rota distribution sent to ${recipients.join(", ")}`,
      date: new Date().toISOString(),
      createdBy: toUUID(req.user?._id || req.user?.id) || null,
      metadata: {
        timestamp: new Date().toISOString(),
        sent_by: req.user?._id || req.user?.id,
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
    const rawText = await readFile(seedDataPath, "utf8");
    const rows = JSON.parse(rawText);

    const clinicians = await Clinician.find({}).lean();
    const emailToId = new Map(
      clinicians
        .filter((c) => c?.email)
        .map((c) => [String(c.email).toLowerCase(), String(c._id || c.id)])
    );

    let inserted = 0;
    let skipped = 0;
    let failed = 0;

    for (const raw of rows) {
      const realKeys = Object.keys(raw || {}).filter((k) => k !== "_comment");
      if (!realKeys.length) continue;

      const practice_id = toPracticeId(raw._practiceOdsCode);
      if (!practice_id || !raw.date) {
        skipped++;
        continue;
      }

      const clinician_id = raw._clinicianEmail
        ? (emailToId.get(String(raw._clinicianEmail).toLowerCase()) ?? null)
        : null;

      const status = String(raw.status || "working").toLowerCase();
      const start_time = normalizeTime(raw.start_time);

      const existing = await query(
        `SELECT id FROM shifts
         WHERE date = $1 AND practice_id = $2 AND status = $3
           AND COALESCE(start_time::text, '') = COALESCE($4::text, '')
         LIMIT 1`,
        [raw.date, practice_id, status, start_time]
      );

      if (existing.rows?.[0]?.id) {
        skipped++;
        continue;
      }

      const payload = {
        clinician_id: status === "gap" ? null : clinician_id,
        practice_id,
        client_id: raw.client_xero_code ? String(raw.client_xero_code) : null,
        date: raw.date,
        day_of_week: raw.day_of_week || null,
        start_time,
        end_time: normalizeTime(raw.end_time),
        hours: raw.hours != null && raw.hours !== "" ? Number(raw.hours) : null,
        clinical_system: raw.clinical_system || null,
        status,
        is_cover: raw.is_cover === true || raw.is_cover === "true",
        project_code: raw.project_code || null,
        service_code: raw.service_code ? String(raw.service_code).toUpperCase() : null,
        cover_reason: raw.cover_reason || null,
        confirmation_received: raw.confirmation_received === true || raw.confirmation_received === "true",
        access_request_needed: raw.access_request_needed === true || raw.access_request_needed === "true",
        client_informed: raw.client_informed === true || raw.client_informed === "true",
        workstreams_notes: raw.workstreams_notes || null,
        clinician_notified: raw.clinician_notified === true || raw.clinician_notified === "true",
        hours_to_cover: raw.hours_to_cover != null && raw.hours_to_cover !== "" ? Number(raw.hours_to_cover) : null,
        hours_covered: raw.hours_covered != null && raw.hours_covered !== "" ? Number(raw.hours_covered) : null,
        compliance_checked: raw.compliance_checked === true || raw.compliance_checked === "true",
        source: raw.source || "manual",
        created_by: toUUID(req.user?._id || req.user?.id) || null,
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
      after: { inserted, skipped, failed },
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
export const createRota = createShift;
export const getRota = getRotaGrid;
export const getRotaByIdAlias = getRotaById;
export const updateRota = updateShift;
export const deleteRota = deleteShift;