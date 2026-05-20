/**
 * controllers/timesheetController.js
 * FIX: Removed all Supabase client calls — now uses PostgreSQL query() throughout.
 * FIX 2: ensureDraftTimesheet query now uses EXTRACT(MONTH/YEAR FROM shift_date)
 *         instead of rota_month/rota_year which don't exist in rota_shifts.
 *         Also uses status = 'working' instead of shift_type = 'working'.
 */

import { asyncHandler } from "../lib/asyncHandler.js";
import { query } from "../config/db.js";
import { calculateFTE, calculateHours, compareHours } from "../lib/timesheetCalc.js";
import Timesheet from "../models/Timesheet.js";
import TimesheetEntry from "../models/TimesheetEntry.js";

const ok   = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, data, message });
const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const userId      = (req) => req.user?._id || req.user?.id;
const clinicianId = (req) =>
  req.user?.clinicianId || req.user?.clinician_id || userId(req);

// ─── helpers ─────────────────────────────────────────────────────────────────

function withEntryMeta(entry) {
  const comparison = compareHours(entry.expected_hours, entry.actual_hours);
  return {
    ...entry,
    surgery_name: entry.surgery_name || "Surgery",
    difference:   comparison.difference,
    flag_color:   comparison.flag_color,
  };
}

async function fetchEntries(timesheet_id) {
  const entries = await TimesheetEntry.findByTimesheet(timesheet_id);
  return entries.map((e) => withEntryMeta(e));
}

/**
 * Find-or-create a draft timesheet and auto-populate entries from rota_shifts.
 *
 * ✅ FIX: rota_shifts has shift_date (DATE column), NOT rota_month/rota_year.
 *         Use EXTRACT(MONTH FROM shift_date) and EXTRACT(YEAR FROM shift_date).
 *         Also rota_shifts uses `status` column, not `shift_type`.
 *         Cover shifts also included (status = 'cover').
 */
async function ensureDraftTimesheet(req, month, year) {
  const cid = clinicianId(req);

  // 1. Find or create the timesheet row
  let timesheet = await Timesheet.findByClinicianMonth(cid, month, year);
  if (!timesheet) {
    timesheet = await Timesheet.create({ clinician_id: cid, month, year, status: "draft" });
  }

  // 2. Only seed entries if none exist yet
  const existingEntries = await TimesheetEntry.findByTimesheet(timesheet.id);
  if (existingEntries.length > 0) return timesheet;

  // 3. ✅ FIX: Pull matching rota_shifts using EXTRACT on shift_date
  //           Include both 'working' and 'cover' shifts
  const shiftsResult = await query(
    `SELECT
        rs.*,
        p.name AS surgery_name
      FROM rota_shifts rs
      LEFT JOIN practices p ON p.id = rs.practice_id
      WHERE rs.clinician_id = $1
        AND EXTRACT(MONTH FROM rs.shift_date) = $2
        AND EXTRACT(YEAR  FROM rs.shift_date) = $3
        AND rs.status IN ('working', 'cover')
      ORDER BY rs.shift_date ASC`,
    [cid, month, year]
  );

  const shifts = shiftsResult.rows;

  if (shifts.length === 0) return timesheet;

  // 4. Calculate expected_hours from shift_start / shift_end if not stored
  const entries = shifts.map((shift) => {
    const expectedHours =
      shift.expected_hours ??
      (shift.shift_start && shift.shift_end
        ? calculateHours(shift.shift_start, shift.shift_end)
        : null);

    return {
      timesheet_id:   timesheet.id,
      clinician_id:   cid,
      // ✅ FIX: rota_shifts uses practice_id, not surgery_id
      surgery_id:     shift.surgery_id ?? shift.practice_id ?? null,
      surgery_name:   shift.surgery_name ?? shift.practice_name ?? null,
      shift_date:     shift.shift_date,
      start_time:     null,
      end_time:       null,
      actual_hours:   null,
      expected_hours: expectedHours,
      is_cover:       shift.status === "cover" || !!shift.is_cover,
      project_code:   shift.status === "cover" ? "COVER" : (shift.project_code ?? null),
      service_code:   shift.service_code ?? null,
      notes:          "",
    };
  });

  await TimesheetEntry.upsert(entries);
  return timesheet;
}

async function updateTotal(timesheet_id) {
  const total_hours = await TimesheetEntry.calculateTotalHours(timesheet_id);
  await Timesheet.updateStatus(timesheet_id, { total_hours });
  return total_hours;
}

// ─── handlers ────────────────────────────────────────────────────────────────

export const getMyTimesheet = asyncHandler(async (req, res) => {
  const month = Number(req.params.month || req.query.month);
  const year  = Number(req.params.year  || req.query.year);
  if (!month || !year) return fail(res, 400, "month and year are required");

  const timesheet = await ensureDraftTimesheet(req, month, year);
  const entries   = await fetchEntries(timesheet.id);
  return ok(res, { timesheet, entries });
});

export const updateTimesheetEntry = asyncHandler(async (req, res) => {
  const { start_time, end_time, notes = "" } = req.body || {};
  if (start_time && end_time && calculateHours(start_time, end_time) === null) {
    return fail(res, 400, "start_time must be before end_time");
  }

  const current = await TimesheetEntry.findByIdWithStatus(req.params.id, clinicianId(req));
  if (!current) return fail(res, 404, "Timesheet entry not found");
  if (!["draft", "rejected"].includes(current.timesheet_status)) {
    return fail(res, 409, "Only draft or rejected timesheets can be edited");
  }

  const entry       = await TimesheetEntry.updateHours(req.params.id, { start_time, end_time, notes });
  const total_hours = await updateTotal(entry.timesheet_id);
  return ok(res, { entry: withEntryMeta(entry), total_hours }, "Timesheet entry updated");
});

export const submitTimesheet = asyncHandler(async (req, res) => {
  const cid = clinicianId(req);
  let timesheet = null;

  if (req.body?.timesheetId || req.body?.timesheet_id) {
    const result = await query(
      `SELECT * FROM timesheets WHERE id = $1 AND clinician_id = $2 LIMIT 1`,
      [req.body.timesheetId || req.body.timesheet_id, cid]
    );
    timesheet = result.rows[0] || null;
  } else if (req.body?.month && req.body?.year) {
    timesheet = await Timesheet.findByClinicianMonth(cid, req.body.month, req.body.year);
  }

  if (!timesheet) return fail(res, 404, "Timesheet not found");
  if (!["draft", "rejected"].includes(timesheet.status))
    return fail(res, 409, "Timesheet cannot be submitted");

  const entries = await TimesheetEntry.findByTimesheet(timesheet.id);
  if (!entries.length) return fail(res, 400, "Cannot submit an empty timesheet");

  const incomplete = entries.filter((e) => !e.start_time || !e.end_time);
  if (incomplete.length) return fail(res, 400, "All entries must have start_time and end_time");

  const badCover = entries.filter(
    (e) => e.is_cover && (e.project_code !== "COVER" || !e.service_code)
  );
  if (badCover.length)
    return fail(res, 400, "Cover entries must have project_code='COVER' and service_code");

  const total_hours = await updateTotal(timesheet.id);
  const submitted   = await Timesheet.updateStatus(timesheet.id, {
    status:           "submitted",
    submitted_at:     new Date().toISOString(),
    rejected_at:      null,
    rejected_by:      null,
    rejection_reason: null,
    total_hours,
  });

  return ok(res, submitted, "Timesheet submitted");
});

export const getPendingTimesheets = asyncHandler(async (_req, res) => {
  const timesheets = await Timesheet.getPending();
  const data = await Promise.all(
    timesheets.map(async (sheet) => {
      const entries = await fetchEntries(sheet.id);
      return {
        ...sheet,
        clinician_name: sheet.clinician_name || "Clinician",
        role:           sheet.clinician_type  || sheet.contract_type || "",
        surgery_names:  [...new Set(entries.map((e) => e.surgery_name).filter(Boolean))],
      };
    })
  );
  return ok(res, data);
});

export const getTimesheetDetail = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ts.*,
            COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name,
            c.clinician_type,
            c.contract_type
       FROM timesheets ts
       LEFT JOIN clinicians c ON c.id = ts.clinician_id
      WHERE ts.id = $1
      LIMIT 1`,
    [req.params.id]
  );

  if (!result.rows[0]) return fail(res, 404, "Timesheet not found");

  const timesheet      = result.rows[0];
  const entries        = await fetchEntries(timesheet.id);
  const total_expected = Math.round(
    entries.reduce((s, e) => s + Number(e.expected_hours || 0), 0) * 100
  ) / 100;
  const total_actual   = Math.round(
    entries.reduce((s, e) => s + Number(e.actual_hours   || 0), 0) * 100
  ) / 100;

  return ok(res, {
    timesheet,
    entries,
    summary: {
      total_expected,
      total_actual,
      difference: Math.round((total_actual - total_expected) * 100) / 100,
      fte:        calculateFTE(total_actual),
    },
  });
});

export const approveTimesheet = asyncHandler(async (req, res) => {
  const approved = await Timesheet.approve(req.params.id, userId(req));
  if (!approved) return fail(res, 404, "Timesheet not found");
  return ok(res, approved, "Timesheet approved");
});

export const rejectTimesheet = asyncHandler(async (req, res) => {
  const reason = String(req.body?.rejection_reason || req.body?.reason || "").trim();
  if (!reason) return fail(res, 400, "rejection_reason is required");
  const rejected = await Timesheet.reject(req.params.id, userId(req), reason);
  if (!rejected) return fail(res, 404, "Timesheet not found");
  return ok(res, rejected, "Timesheet rejected");
});

export const getTimesheetHistory = asyncHandler(async (req, res) => {
  const history = await Timesheet.getHistory(req.query || {});
  return ok(res, history);
});

// ✅ Admin fetches a specific clinician's timesheet (for CalendarPanel → Timesheet view)
export const adminGetClinicianTimesheet = asyncHandler(async (req, res) => {
  const month = Number(req.query.month);
  const year  = Number(req.query.year);
  const sheet = await Timesheet.findByClinicianMonth(req.params.clinicianId, month, year);
  if (!sheet) return ok(res, { timesheet: null, entries: [] });
  const entries = await fetchEntries(sheet.id);
  return ok(res, { timesheet: sheet, entries });
});

// ─── aliases (keeps existing route bindings working) ─────────────────────────
export const adminGetTimesheets        = getTimesheetHistory;
export const adminGetPendingTimesheets = getPendingTimesheets;
export const adminGetTimesheetDetail   = getTimesheetDetail;
export const adminApproveTimesheetPost = approveTimesheet;
export const adminRejectTimesheetPost  = rejectTimesheet;
export const adminApproveTimesheet     = asyncHandler(async (req, res) => {
  if (req.body?.action === "rejected") {
    const reason = String(req.body?.rejection_reason || req.body?.reason || "").trim();
    if (!reason) return fail(res, 400, "rejection_reason is required");
    const rejected = await Timesheet.reject(req.params.id, userId(req), reason);
    return ok(res, rejected, "Timesheet rejected");
  }
  const approved = await Timesheet.approve(req.params.id, userId(req));
  return ok(res, approved, "Timesheet approved");
});