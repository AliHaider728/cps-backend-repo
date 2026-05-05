/**
 * controllers/rotaController.js — Module 5 (Rota & Shift Management)
 *
 * Mounted under /api/rota
 */

import nodemailer from "nodemailer";
import { query } from "../config/db.js";
import { logAudit } from "../middleware/auditLogger.js";
import { normalizeId } from "../lib/ids.js";

import Clinician from "../models/Clinician.js";
import RestrictedClinician from "../models/RestrictedClinician.js";
import ClinicianComplianceDoc from "../models/ClinicianComplianceDoc.js";
import ContactHistory from "../models/ContactHistory.js";

const toId = (v) => normalizeId(v);

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, data, message });

const fail = (res, status, message, data = null) =>
  res.status(status).json({ success: false, data, message });

const parseIntStrict = (value) => {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
};

const isValidServiceCode = (code) => ["PCN", "EA", "GPX"].includes(String(code || "").toUpperCase());

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

export function validateCoverEntry(entry = {}) {
  const isCover = entry.is_cover === true || entry.is_cover === "true";

  if (isCover) {
    if (String(entry.project_code || "").trim() !== "COV1") {
      const err = new Error("Cover shifts must use project_code = COV1");
      err.statusCode = 400;
      throw err;
    }

    const service = String(entry.service_code || "").toUpperCase();
    if (!isValidServiceCode(service)) {
      const err = new Error("Cover shifts must use service_code PCN | EA | GPX");
      err.statusCode = 400;
      throw err;
    }
  }

  const status = String(entry.status || "").toLowerCase();
  const allowed = ["working", "annual_leave", "sick", "cppe", "cover", "gap", "cancelled"];
  if (!allowed.includes(status)) {
    const err = new Error("Invalid shift status");
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

export async function checkRestrictedClinician(clinicianId, practiceId) {
  const clinician = toId(clinicianId);
  const practice = toId(practiceId) || String(practiceId || "").trim();

  if (!clinician || !practice) {
    return { blocked: false, reason: "" };
  }

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

export async function checkMandatoryCompliance(clinicianId) {
  const id = toId(clinicianId);
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

export const checkRestrictedClinicianEntry = async (req, res, next) => {
  try {
    const clinicianId = toId(req.query.clinicianId);
    const practiceId = toId(req.query.practiceId) || req.query.practiceId;
    if (!clinicianId || !practiceId) return fail(res, 400, "clinicianId and practiceId are required");
    const result = await checkRestrictedClinician(clinicianId, practiceId);
    return ok(res, result, "Restricted clinician check");
  } catch (err) {
    next(err);
  }
};

export const checkMandatoryComplianceEntry = async (req, res, next) => {
  try {
    const clinicianId = toId(req.query.clinicianId);
    if (!clinicianId) return fail(res, 400, "clinicianId is required");
    const result = await checkMandatoryCompliance(clinicianId);
    return ok(res, result, "Compliance check");
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

export function buildRotaEmailHTML(rotaData, month, year) {
  const title = `Rota for ${String(month).padStart(2, "0")}/${year}`;
  const rows = Array.isArray(rotaData) ? rotaData : [];

  const bodyRows = rows
    .map((s) => {
      const date = s.date ? String(s.date).slice(0, 10) : "";
      const start = s.start_time || "";
      const end = s.end_time || "";
      const status = s.status || "";
      const practice = s.practice_id || "";
      const clinician = s.clinician_id || "";

      return `
        <tr>
          <td style="padding:8px;border:1px solid #e5e7eb;">${date}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${start} - ${end}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${status}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${practice}</td>
          <td style="padding:8px;border:1px solid #e5e7eb;">${clinician}</td>
        </tr>`;
    })
    .join("\n");

  return `
    <div style="font-family:Segoe UI, Arial, sans-serif;">
      <h2 style="margin:0 0 10px;">${title}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">Generated by CPS Intranet.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr>
            <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Date</th>
            <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Time</th>
            <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Status</th>
            <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Practice</th>
            <th align="left" style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;">Clinician</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || ""}
        </tbody>
      </table>
    </div>
  `;
}

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseIntStrict(process.env.EMAIL_PORT) ?? 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const monthRange = (month, year) => {
  const m = parseIntStrict(month);
  const y = parseIntStrict(year);
  if (!m || !y || m < 1 || m > 12) return null;

  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const mapShiftRow = (row) => row;

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));

const fetchShiftById = async (shiftId) => {
  const id = toId(shiftId);
  if (!id) return null;
  const result = await query(`SELECT * FROM shifts WHERE id = $1 LIMIT 1`, [id]);
  return result.rows?.[0] || null;
};

/* ─────────────────────────────────────────────────────────────
 * Primary API (used by routes/rotaRoutes.js)
 * ───────────────────────────────────────────────────────────── */

export const getRotaGrid = async (req, res, next) => {
  try {
    const range = monthRange(req.query.month, req.query.year);
    if (!range) return fail(res, 400, "month and year are required");

    const clinicians = await Clinician.find({ isActive: true }).lean();
    clinicians.sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));

    const shiftsRes = await query(
      `SELECT * FROM shifts WHERE date >= $1 AND date < $2 ORDER BY date ASC`,
      [range.startDate, range.endDate]
    );

    const shifts = shiftsRes.rows.map(mapShiftRow);

    const byClinician = new Map();
    for (const c of clinicians) {
      byClinician.set(String(c._id || c.id), {
        clinician: c,
        shifts: {},
      });
    }

    for (const s of shifts) {
      const clinicianId = s.clinician_id ? String(s.clinician_id) : null;
      if (!clinicianId) continue;
      if (!byClinician.has(clinicianId)) {
        byClinician.set(clinicianId, { clinician: { _id: clinicianId }, shifts: {} });
      }
      const dayKey = String(s.date);
      byClinician.get(clinicianId).shifts[dayKey] = s;
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

export const getClinicianRota = async (req, res, next) => {
  try {
    const clinicianId = toId(req.params.id);
    if (!clinicianId) return fail(res, 400, "Invalid clinician id");

    const range = monthRange(req.query.month, req.query.year);
    if (!range) return fail(res, 400, "month and year are required");

    const clinician = await Clinician.findById(clinicianId).lean();
    if (!clinician) return fail(res, 404, "Clinician not found");

    const shiftsRes = await query(
      `SELECT * FROM shifts
       WHERE clinician_id = $1 AND date >= $2 AND date < $3
       ORDER BY date ASC`,
      [clinicianId, range.startDate, range.endDate]
    );

    return ok(res, {
      clinician,
      month: parseIntStrict(req.query.month),
      year: parseIntStrict(req.query.year),
      shifts: shiftsRes.rows.map(mapShiftRow),
    });
  } catch (err) {
    next(err);
  }
};

export const generateMonthlyRota = async (req, res, next) => {
  try {
    const month = parseIntStrict(req.body?.month);
    const year = parseIntStrict(req.body?.year);
    const range = monthRange(month, year);
    if (!range) return fail(res, 400, "month and year are required");

    await logAudit(req, "ROTA_GENERATE_REQUESTED", "Rota", {
      detail: `Generate rota requested for ${String(month).padStart(2, "0")}/${year}`,
      after: { month, year },
    });

    return ok(res, { month, year, queued: true }, "Rota generation queued");
  } catch (err) {
    next(err);
  }
};

export const createShift = async (req, res, next) => {
  try {
    const body = req.body || {};

    const payload = {
      clinician_id: toId(body.clinician_id) || null,
      practice_id: toId(body.practice_id) || body.practice_id,
      client_id: toId(body.client_id) || null,
      date: body.date,
      day_of_week: body.day_of_week || null,
      start_time: body.start_time || null,
      end_time: body.end_time || null,
      hours: body.hours != null && body.hours !== "" ? Number(body.hours) : computeHours(body.start_time, body.end_time),
      clinical_system: body.clinical_system || null,
      status: String(body.status || "working").toLowerCase(),

      is_cover: body.is_cover === true || body.is_cover === "true",
      project_code: body.project_code || null,
      service_code: body.service_code ? String(body.service_code).toUpperCase() : null,
      original_gap_id: toId(body.original_gap_id) || null,
      cover_reason: body.cover_reason || null,

      confirmation_received: body.confirmation_received === true || body.confirmation_received === "true",
      access_request_needed: body.access_request_needed === true || body.access_request_needed === "true",
      client_informed: body.client_informed === true || body.client_informed === "true",
      workstreams_notes: body.workstreams_notes || null,
      clinician_notified: body.clinician_notified === true || body.clinician_notified === "true",
      hours_to_cover: body.hours_to_cover != null && body.hours_to_cover !== "" ? Number(body.hours_to_cover) : null,
      hours_covered: body.hours_covered != null && body.hours_covered !== "" ? Number(body.hours_covered) : null,

      compliance_checked: body.compliance_checked === true || body.compliance_checked === "true",
      compliance_override_by: toId(body.compliance_override_by) || null,
      compliance_override_reason: body.compliance_override_reason || null,

      source: body.source || "manual",
      source_leave_id: toId(body.source_leave_id) || null,

      created_by: req.user?._id || req.user?.id || null,
    };

    if (!payload.practice_id) return fail(res, 400, "practice_id is required");
    if (!payload.date) return fail(res, 400, "date is required");

    validateCoverEntry(payload);

    if (payload.clinician_id) {
      const restriction = await checkRestrictedClinician(payload.clinician_id, payload.practice_id);
      if (restriction.blocked) {
        await logAudit(req, "ROTA_BOOKING_BLOCKED_RESTRICTED", "Shift", {
          detail: `Blocked booking: restricted clinician at practice ${payload.practice_id}`,
          after: { clinicianId: payload.clinician_id, practiceId: payload.practice_id, reason: restriction.reason },
          status: "blocked",
        });
        return fail(res, 403, restriction.reason || "Clinician is restricted at this practice");
      }

      const compliance = await checkMandatoryCompliance(payload.clinician_id);
      if (!compliance.passed) {
        const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
        const overrideBy = payload.compliance_override_by || null;
        const overrideReason = String(payload.compliance_override_reason || "").trim();

        if (!(canOverride && overrideBy && overrideReason)) {
          await logAudit(req, "ROTA_BOOKING_BLOCKED_COMPLIANCE", "Shift", {
            detail: `Blocked booking: missing compliance (${compliance.missing.join(", ")})`,
            after: { clinicianId: payload.clinician_id, missing: compliance.missing },
            status: "blocked",
          });

          return fail(res, 409, "Clinician missing mandatory compliance", { missing: compliance.missing });
        }

        payload.compliance_checked = true;
      } else {
        payload.compliance_checked = true;
      }
    }

    const insertRes = await query(
      `INSERT INTO shifts (
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,
        $23,$24,$25,
        $26,$27,
        $28
      ) RETURNING *`,
      [
        payload.clinician_id,
        payload.practice_id,
        payload.client_id,
        payload.date,
        payload.day_of_week,
        payload.start_time,
        payload.end_time,
        payload.hours,
        payload.clinical_system,
        payload.status,
        payload.is_cover,
        payload.project_code,
        payload.service_code,
        payload.original_gap_id,
        payload.cover_reason,
        payload.confirmation_received,
        payload.access_request_needed,
        payload.client_informed,
        payload.workstreams_notes,
        payload.clinician_notified,
        payload.hours_to_cover,
        payload.hours_covered,
        payload.compliance_checked,
        payload.compliance_override_by,
        payload.compliance_override_reason,
        payload.source,
        payload.source_leave_id,
        payload.created_by,
      ]
    );

    const created = insertRes.rows[0];

    await logAudit(req, "CREATE_SHIFT", "Shift", {
      resourceId: created.id,
      detail: `Created shift (${created.status}) on ${created.date} for practice ${created.practice_id}`,
      after: safeJson(created),
    });

    return ok(res, created, "Shift created", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

export const updateShift = async (req, res, next) => {
  try {
    const shiftId = toId(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid shift id");

    const before = await fetchShiftById(shiftId);
    if (!before) return fail(res, 404, "Shift not found");

    const body = req.body || {};
    const patch = {
      clinician_id: typeof body.clinician_id !== "undefined" ? (toId(body.clinician_id) || null) : before.clinician_id,
      practice_id: typeof body.practice_id !== "undefined" ? (toId(body.practice_id) || body.practice_id) : before.practice_id,
      client_id: typeof body.client_id !== "undefined" ? (toId(body.client_id) || null) : before.client_id,
      date: typeof body.date !== "undefined" ? body.date : before.date,
      day_of_week: typeof body.day_of_week !== "undefined" ? body.day_of_week : before.day_of_week,
      start_time: typeof body.start_time !== "undefined" ? body.start_time : before.start_time,
      end_time: typeof body.end_time !== "undefined" ? body.end_time : before.end_time,
      hours:
        typeof body.hours !== "undefined"
          ? (body.hours != null && body.hours !== "" ? Number(body.hours) : null)
          : (typeof body.start_time !== "undefined" || typeof body.end_time !== "undefined")
            ? (computeHours(typeof body.start_time !== "undefined" ? body.start_time : before.start_time, typeof body.end_time !== "undefined" ? body.end_time : before.end_time) ?? before.hours)
            : before.hours,
      clinical_system: typeof body.clinical_system !== "undefined" ? body.clinical_system : before.clinical_system,
      status: typeof body.status !== "undefined" ? String(body.status).toLowerCase() : before.status,

      is_cover: typeof body.is_cover !== "undefined" ? (body.is_cover === true || body.is_cover === "true") : before.is_cover,
      project_code: typeof body.project_code !== "undefined" ? body.project_code : before.project_code,
      service_code: typeof body.service_code !== "undefined" ? (body.service_code ? String(body.service_code).toUpperCase() : null) : before.service_code,
      original_gap_id: typeof body.original_gap_id !== "undefined" ? (toId(body.original_gap_id) || null) : before.original_gap_id,
      cover_reason: typeof body.cover_reason !== "undefined" ? body.cover_reason : before.cover_reason,

      confirmation_received: typeof body.confirmation_received !== "undefined" ? (body.confirmation_received === true || body.confirmation_received === "true") : before.confirmation_received,
      access_request_needed: typeof body.access_request_needed !== "undefined" ? (body.access_request_needed === true || body.access_request_needed === "true") : before.access_request_needed,
      client_informed: typeof body.client_informed !== "undefined" ? (body.client_informed === true || body.client_informed === "true") : before.client_informed,
      workstreams_notes: typeof body.workstreams_notes !== "undefined" ? body.workstreams_notes : before.workstreams_notes,
      clinician_notified: typeof body.clinician_notified !== "undefined" ? (body.clinician_notified === true || body.clinician_notified === "true") : before.clinician_notified,
      hours_to_cover: typeof body.hours_to_cover !== "undefined" ? (body.hours_to_cover != null && body.hours_to_cover !== "" ? Number(body.hours_to_cover) : null) : before.hours_to_cover,
      hours_covered: typeof body.hours_covered !== "undefined" ? (body.hours_covered != null && body.hours_covered !== "" ? Number(body.hours_covered) : null) : before.hours_covered,

      compliance_checked: typeof body.compliance_checked !== "undefined" ? (body.compliance_checked === true || body.compliance_checked === "true") : before.compliance_checked,
      compliance_override_by: typeof body.compliance_override_by !== "undefined" ? (toId(body.compliance_override_by) || null) : before.compliance_override_by,
      compliance_override_reason: typeof body.compliance_override_reason !== "undefined" ? body.compliance_override_reason : before.compliance_override_reason,

      source: typeof body.source !== "undefined" ? body.source : before.source,
      source_leave_id: typeof body.source_leave_id !== "undefined" ? (toId(body.source_leave_id) || null) : before.source_leave_id,
    };

    validateCoverEntry(patch);

    if (patch.clinician_id) {
      const restriction = await checkRestrictedClinician(patch.clinician_id, patch.practice_id);
      if (restriction.blocked) {
        await logAudit(req, "ROTA_UPDATE_BLOCKED_RESTRICTED", "Shift", {
          resourceId: shiftId,
          detail: `Blocked shift update: restricted clinician at practice ${patch.practice_id}`,
          after: { clinicianId: patch.clinician_id, practiceId: patch.practice_id, reason: restriction.reason },
          status: "blocked",
        });
        return fail(res, 403, restriction.reason || "Clinician is restricted at this practice");
      }
    }

    const updateRes = await query(
      `UPDATE shifts SET
        clinician_id = $2,
        practice_id = $3,
        client_id = $4,
        date = $5,
        day_of_week = $6,
        start_time = $7,
        end_time = $8,
        hours = $9,
        clinical_system = $10,
        status = $11,
        is_cover = $12,
        project_code = $13,
        service_code = $14,
        original_gap_id = $15,
        cover_reason = $16,
        confirmation_received = $17,
        access_request_needed = $18,
        client_informed = $19,
        workstreams_notes = $20,
        clinician_notified = $21,
        hours_to_cover = $22,
        hours_covered = $23,
        compliance_checked = $24,
        compliance_override_by = $25,
        compliance_override_reason = $26,
        source = $27,
        source_leave_id = $28,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [
        shiftId,
        patch.clinician_id,
        patch.practice_id,
        patch.client_id,
        patch.date,
        patch.day_of_week,
        patch.start_time,
        patch.end_time,
        patch.hours,
        patch.clinical_system,
        patch.status,
        patch.is_cover,
        patch.project_code,
        patch.service_code,
        patch.original_gap_id,
        patch.cover_reason,
        patch.confirmation_received,
        patch.access_request_needed,
        patch.client_informed,
        patch.workstreams_notes,
        patch.clinician_notified,
        patch.hours_to_cover,
        patch.hours_covered,
        patch.compliance_checked,
        patch.compliance_override_by,
        patch.compliance_override_reason,
        patch.source,
        patch.source_leave_id,
      ]
    );

    const updated = updateRes.rows[0];

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

export const deleteShift = async (req, res, next) => {
  try {
    const shiftId = toId(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid shift id");

    const before = await fetchShiftById(shiftId);
    if (!before) return fail(res, 404, "Shift not found");

    await query(`DELETE FROM shifts WHERE id = $1`, [shiftId]);

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

export const getGapReport = async (req, res, next) => {
  try {
    const days = parseIntStrict(req.query.days) ?? 14;
    const start = new Date();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const gapsRes = await query(
      `SELECT * FROM shifts
       WHERE status = 'gap' AND date >= $1 AND date <= $2
       ORDER BY date ASC`,
      [startDate, endDate]
    );

    const gaps = gapsRes.rows.map((g) => {
      const gapDate = new Date(`${String(g.date).slice(0, 10)}T00:00:00Z`).getTime();
      const msUntil = gapDate - Date.now();
      const urgent = msUntil <= 48 * 60 * 60 * 1000;
      return { ...g, urgent };
    });

    await detectGaps(req, gaps);

    return ok(res, { days, gaps, total: gaps.length }, "Gap report");
  } catch (err) {
    next(err);
  }
};

export const detectGaps = async (req, preloadedGaps = null) => {
  const gaps = Array.isArray(preloadedGaps)
    ? preloadedGaps
    : (
      await query(
        `SELECT * FROM shifts
         WHERE status = 'gap' AND date >= CURRENT_DATE AND date <= (CURRENT_DATE + INTERVAL '14 days')
         ORDER BY date ASC`
      )
    ).rows.map((g) => {
      const gapDate = new Date(`${String(g.date).slice(0, 10)}T00:00:00Z`).getTime();
      const msUntil = gapDate - Date.now();
      const urgent = msUntil <= 48 * 60 * 60 * 1000;
      return { ...g, urgent };
    });

  const urgentGaps = gaps.filter((g) => g.urgent);
  if (urgentGaps.length === 0) return { total: gaps.length, urgent: 0 };

  const opsEmail = process.env.ROTA_ALERT_EMAIL || process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (opsEmail) {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: opsEmail,
      subject: `URGENT rota gaps detected (${urgentGaps.length})`,
      html: `<p>The following gaps are within 48 hours and require urgent cover assignment.</p>${buildRotaEmailHTML(urgentGaps)}`,
    });
  }

  if (req) {
    await logAudit(req, "ROTA_URGENT_GAPS_EMAIL", "Shift", {
      detail: `Urgent gap notification sent for ${urgentGaps.length} shifts`,
      after: safeJson({ urgentGapIds: urgentGaps.map((g) => g.id) }),
    });
  }

  return { total: gaps.length, urgent: urgentGaps.length };
};

export const assignCover = async (req, res, next) => {
  try {
    const body = req.body || {};
    const gapId = toId(body.gapId || body.original_gap_id);
    const clinicianId = toId(body.clinicianId || body.clinician_id);

    if (!gapId) return fail(res, 400, "gapId is required");
    if (!clinicianId) return fail(res, 400, "clinicianId is required");

    const gap = await fetchShiftById(gapId);
    if (!gap) return fail(res, 404, "Gap shift not found");
    if (String(gap.status) !== "gap") return fail(res, 409, "Shift is not a gap");

    const coverPayload = {
      clinician_id: clinicianId,
      practice_id: gap.practice_id,
      client_id: gap.client_id,
      date: gap.date,
      day_of_week: gap.day_of_week,
      start_time: body.start_time || gap.start_time,
      end_time: body.end_time || gap.end_time,
      hours: body.hours != null && body.hours !== "" ? Number(body.hours) : (gap.hours ?? computeHours(body.start_time || gap.start_time, body.end_time || gap.end_time)),
      clinical_system: body.clinical_system || gap.clinical_system,
      status: "cover",

      is_cover: true,
      project_code: "COV1",
      service_code: body.service_code ? String(body.service_code).toUpperCase() : null,
      original_gap_id: gapId,
      cover_reason: body.cover_reason || null,

      confirmation_received: body.confirmation_received === true || body.confirmation_received === "true",
      access_request_needed: body.access_request_needed === true || body.access_request_needed === "true",
      client_informed: body.client_informed === true || body.client_informed === "true",
      workstreams_notes: body.workstreams_notes || null,
      clinician_notified: body.clinician_notified === true || body.clinician_notified === "true",
      hours_to_cover: body.hours_to_cover != null && body.hours_to_cover !== "" ? Number(body.hours_to_cover) : gap.hours_to_cover,
      hours_covered: body.hours_covered != null && body.hours_covered !== "" ? Number(body.hours_covered) : gap.hours_covered,

      compliance_checked: false,
      compliance_override_by: toId(body.compliance_override_by) || null,
      compliance_override_reason: body.compliance_override_reason || null,

      source: "manual",
      source_leave_id: null,
      created_by: req.user?._id || req.user?.id || null,
    };

    validateCoverEntry(coverPayload);

    const restriction = await checkRestrictedClinician(clinicianId, gap.practice_id);
    if (restriction.blocked) {
      await logAudit(req, "COVER_ASSIGN_BLOCKED_RESTRICTED", "Shift", {
        detail: `Blocked cover assignment: restricted clinician at practice ${gap.practice_id}`,
        after: { clinicianId, practiceId: gap.practice_id, reason: restriction.reason },
        status: "blocked",
      });
      return fail(res, 403, restriction.reason || "Clinician is restricted at this practice");
    }

    const compliance = await checkMandatoryCompliance(clinicianId);
    if (!compliance.passed) {
      const canOverride = ["super_admin", "ops_manager"].includes(String(req.user?.role || ""));
      const overrideBy = coverPayload.compliance_override_by || null;
      const overrideReason = String(coverPayload.compliance_override_reason || "").trim();

      if (!(canOverride && overrideBy && overrideReason)) {
        await logAudit(req, "COVER_ASSIGN_BLOCKED_COMPLIANCE", "Shift", {
          detail: `Blocked cover assignment: missing compliance (${compliance.missing.join(", ")})`,
          after: { clinicianId, missing: compliance.missing },
          status: "blocked",
        });

        return fail(res, 409, "Clinician missing mandatory compliance", { missing: compliance.missing });
      }

      coverPayload.compliance_checked = true;
    } else {
      coverPayload.compliance_checked = true;
    }

    const coverRes = await query(
      `INSERT INTO shifts (
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,
        $16,$17,$18,$19,
        $20,$21,$22,
        $23,$24,$25,
        $26,$27,
        $28
      ) RETURNING *`,
      [
        coverPayload.clinician_id,
        coverPayload.practice_id,
        coverPayload.client_id,
        coverPayload.date,
        coverPayload.day_of_week,
        coverPayload.start_time,
        coverPayload.end_time,
        coverPayload.hours,
        coverPayload.clinical_system,
        coverPayload.status,
        coverPayload.is_cover,
        coverPayload.project_code,
        coverPayload.service_code,
        coverPayload.original_gap_id,
        coverPayload.cover_reason,
        coverPayload.confirmation_received,
        coverPayload.access_request_needed,
        coverPayload.client_informed,
        coverPayload.workstreams_notes,
        coverPayload.clinician_notified,
        coverPayload.hours_to_cover,
        coverPayload.hours_covered,
        coverPayload.compliance_checked,
        coverPayload.compliance_override_by,
        coverPayload.compliance_override_reason,
        coverPayload.source,
        coverPayload.source_leave_id,
        coverPayload.created_by,
      ]
    );

    const coverShift = coverRes.rows[0];

    await query(`UPDATE shifts SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [gapId]);

    await query(
      `UPDATE cover_requests
       SET status = 'filled', filled_by = $2
       WHERE shift_id = $1`,
      [gapId, clinicianId]
    );

    await logAudit(req, "ASSIGN_COVER", "Shift", {
      resourceId: coverShift.id,
      detail: `Assigned cover for gap ${gapId} with clinician ${clinicianId}`,
      after: safeJson({ gapId, coverShiftId: coverShift.id }),
    });

    return ok(res, { gapId, coverShift }, "Cover assigned", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

export const getCoverRequests = async (req, res, next) => {
  try {
    const status = String(req.query.status || "open").toLowerCase();
    const allowed = ["open", "filled", "cancelled"];
    const finalStatus = allowed.includes(status) ? status : "open";

    const result = await query(
      `SELECT * FROM cover_requests WHERE status = $1 ORDER BY date ASC`,
      [finalStatus]
    );

    return ok(res, { status: finalStatus, requests: result.rows, total: result.rows.length }, "Cover requests");
  } catch (err) {
    next(err);
  }
};

export const sendRotaToClient = async (req, res, next) => {
  try {
    const clientId = toId(req.params.clientId) || req.params.clientId;
    if (!clientId) return fail(res, 400, "Invalid clientId");

    const month = parseIntStrict(req.body?.month);
    const year = parseIntStrict(req.body?.year);
    const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients.filter(Boolean) : [];
    const range = monthRange(month, year);

    if (!range) return fail(res, 400, "month and year are required");
    if (recipients.length === 0) return fail(res, 400, "recipients are required");

    const shiftsRes = await query(
      `SELECT * FROM shifts
       WHERE client_id = $1 AND date >= $2 AND date < $3
       ORDER BY date ASC`,
      [clientId, range.startDate, range.endDate]
    );

    const html = buildRotaEmailHTML(shiftsRes.rows, month, year);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: recipients.join(","),
      subject: `CPS Rota ${String(month).padStart(2, "0")}/${year}`,
      html,
    });

    const distRes = await query(
      `INSERT INTO rota_distributions (client_id, client_name, month, year, sent_by, recipient_emails)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id, month, year)
       DO UPDATE SET sent_by = EXCLUDED.sent_by, sent_at = NOW(), recipient_emails = EXCLUDED.recipient_emails
       RETURNING *`,
      [
        clientId,
        String(req.body?.client_name || ""),
        month,
        year,
        req.user?._id || req.user?.id || null,
        recipients,
      ]
    );

    await logAudit(req, "SEND_ROTA_TO_CLIENT", "RotaDistribution", {
      resourceId: distRes.rows[0]?.id,
      detail: `Sent rota to client ${clientId} for ${String(month).padStart(2, "0")}/${year}`,
      after: safeJson({ clientId, month, year, recipients }),
    });

    await ContactHistory.create({
      entityType: "Client",
      entityId: String(clientId),
      type: "email",
      subject: `Rota sent ${String(month).padStart(2, "0")}/${year}`,
      notes: `Rota distribution sent to ${recipients.join(", ")}`,
      date: new Date().toISOString(),
      createdBy: req.user?._id || req.user?.id || null,
      metadata: {
        timestamp: new Date().toISOString(),
        sent_by: req.user?._id || req.user?.id || null,
        recipient_emails: recipients,
      },
    });

    return ok(res, distRes.rows[0], "Rota sent");
  } catch (err) {
    next(err);
  }
};

export const getRotaById = async (req, res, next) => {
  try {
    const shiftId = toId(req.params.id);
    if (!shiftId) return fail(res, 400, "Invalid id");

    const shift = await fetchShiftById(shiftId);
    if (!shift) return fail(res, 404, "Not found");

    return ok(res, shift, "Rota entry");
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────────
 * Additional CRUD aliases requested (Rota = Shift)
 * ───────────────────────────────────────────────────────────── */

export const createRota = createShift;
export const getRota = getRotaGrid;

export const getRotaByIdAlias = getRotaById;

export const updateRota = updateShift;
export const deleteRota = deleteShift;
