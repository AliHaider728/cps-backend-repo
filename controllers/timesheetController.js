import { asyncHandler } from "../lib/asyncHandler.js";
import { getSupabaseClient } from "../lib/supabase.js";
import { calculateFTE, calculateHours, compareHours } from "../lib/timesheetCalc.js";
import Timesheet from "../models/Timesheet.js";
import TimesheetEntry from "../models/TimesheetEntry.js";

const client = () => getSupabaseClient();
const ok = (res, data, message = "OK", status = 200) => res.status(status).json({ success: true, data, message });
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const userId = (req) => req.user?._id || req.user?.id;
const clinicianId = (req) => req.user?.clinicianId || req.user?.clinician_id || userId(req);

function monthRange(month, year) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Number(year), Number(month), 0).toISOString().slice(0, 10);
  return { start, end };
}

function withEntryMeta(entry) {
  const comparison = compareHours(entry.expected_hours, entry.actual_hours);
  return {
    ...entry,
    surgery_name: entry.surgeries?.name || entry.surgery_name || "Surgery",
    difference: comparison.difference,
    flag_color: comparison.flag_color,
  };
}

async function fetchEntries(timesheet_id) {
  const entries = await TimesheetEntry.findByTimesheet(timesheet_id);
  const surgeryIds = [...new Set(entries.map((entry) => entry.surgery_id).filter(Boolean))];
  const names = new Map();
  if (surgeryIds.length > 0) {
    try {
      const { data } = await client().from("surgeries").select("id, name").in("id", surgeryIds);
      (data || []).forEach((row) => names.set(row.id, row.name));
    } catch {
      try {
        const { data } = await client().from("practices").select("id, name").in("id", surgeryIds);
        (data || []).forEach((row) => names.set(row.id, row.name));
      } catch {}
    }
  }
  return entries.map((entry) => withEntryMeta({ ...entry, surgery_name: names.get(entry.surgery_id) || entry.surgery_name }));
}

async function ensureDraftTimesheet(req, month, year) {
  const cid = clinicianId(req);
  let timesheet = await Timesheet.findByClinicianMonth(cid, month, year);
  if (!timesheet) {
    timesheet = await Timesheet.create({ clinician_id: cid, month, year, status: "draft" });
  }

  const existingEntries = await TimesheetEntry.findByTimesheet(timesheet.id);
  if (existingEntries.length > 0) return timesheet;

  const { start, end } = monthRange(month, year);
  const { data: shifts, error } = await client()
    .from("rota_shifts")
    .select("*")
    .eq("clinician_id", cid)
    .gte("shift_date", start)
    .lte("shift_date", end)
    .order("shift_date", { ascending: true });
  if (error) throw error;

  if ((shifts || []).length > 0) {
    await TimesheetEntry.upsert(
      shifts.map((shift) => ({
        timesheet_id: timesheet.id,
        clinician_id: cid,
        surgery_id: shift.surgery_id,
        shift_date: shift.shift_date,
        start_time: null,
        end_time: null,
        actual_hours: null,
        expected_hours: shift.expected_hours,
        is_cover: !!shift.is_cover || shift.shift_type === "cover",
        project_code: shift.is_cover || shift.shift_type === "cover" ? "COVER" : shift.project_code,
        service_code: shift.service_code || null,
        notes: "",
      }))
    );
  }

  return timesheet;
}

async function updateTotal(timesheet_id) {
  const total_hours = await TimesheetEntry.calculateTotalHours(timesheet_id);
  await Timesheet.updateStatus(timesheet_id, { total_hours });
  return total_hours;
}

export const getMyTimesheet = asyncHandler(async (req, res) => {
  const month = Number(req.params.month || req.query.month);
  const year = Number(req.params.year || req.query.year);
  if (!month || !year) return fail(res, 400, "month and year are required");

  const timesheet = await ensureDraftTimesheet(req, month, year);
  const entries = await fetchEntries(timesheet.id);
  return ok(res, { timesheet, entries });
});

export const updateTimesheetEntry = asyncHandler(async (req, res) => {
  const { start_time, end_time, notes = "" } = req.body || {};
  if (start_time && end_time && calculateHours(start_time, end_time) === null) {
    return fail(res, 400, "start_time must be before end_time");
  }

  const { data: current, error: readError } = await client()
    .from("timesheet_entries")
    .select("*, timesheets(status)")
    .eq("id", req.params.id)
    .eq("clinician_id", clinicianId(req))
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(res, 404, "Timesheet entry not found");
  if (current.timesheets?.status !== "draft" && current.timesheets?.status !== "rejected") {
    return fail(res, 409, "Only draft or rejected timesheets can be edited");
  }

  const entry = await TimesheetEntry.updateHours(req.params.id, { start_time, end_time, notes });
  const total_hours = await updateTotal(entry.timesheet_id);
  return ok(res, { entry: withEntryMeta(entry), total_hours }, "Timesheet entry updated");
});

export const submitTimesheet = asyncHandler(async (req, res) => {
  const cid = clinicianId(req);
  let timesheet = null;
  if (req.body?.timesheetId || req.body?.timesheet_id) {
    const { data, error } = await client()
      .from("timesheets")
      .select("*")
      .eq("id", req.body.timesheetId || req.body.timesheet_id)
      .eq("clinician_id", cid)
      .maybeSingle();
    if (error) throw error;
    timesheet = data;
  } else if (req.body?.month && req.body?.year) {
    timesheet = await Timesheet.findByClinicianMonth(cid, req.body.month, req.body.year);
  }

  if (!timesheet) return fail(res, 404, "Timesheet not found");
  if (!["draft", "rejected"].includes(timesheet.status)) return fail(res, 409, "Timesheet cannot be submitted");

  const entries = await TimesheetEntry.findByTimesheet(timesheet.id);
  if (entries.length === 0) return fail(res, 400, "Cannot submit an empty timesheet");

  const incomplete = entries.filter((entry) => !entry.start_time || !entry.end_time);
  if (incomplete.length) return fail(res, 400, "All entries must have start_time and end_time");

  const badCover = entries.filter((entry) => entry.is_cover && (entry.project_code !== "COVER" || !entry.service_code));
  if (badCover.length) return fail(res, 400, "Cover entries must have project_code='COVER' and service_code");

  const total_hours = await updateTotal(timesheet.id);
  const submitted = await Timesheet.updateStatus(timesheet.id, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    total_hours,
  });

  return ok(res, submitted, "Timesheet submitted; super_admin and ops_manager notifications queued");
});

export const getPendingTimesheets = asyncHandler(async (_req, res) => {
  const timesheets = await Timesheet.getPending();
  const data = await Promise.all(
    timesheets.map(async (sheet) => {
      const entries = await fetchEntries(sheet.id);
      return {
        ...sheet,
        clinician_name: sheet.clinicians?.full_name || "Clinician",
        role: sheet.clinicians?.clinician_type || sheet.clinicians?.contract_type || "",
        surgery_names: [...new Set(entries.map((entry) => entry.surgery_name).filter(Boolean))],
      };
    })
  );
  return ok(res, data);
});

export const getTimesheetDetail = asyncHandler(async (req, res) => {
  const { data: timesheet, error } = await client()
    .from("timesheets")
    .select("*, clinicians(full_name, clinician_type, contract_type)")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!timesheet) return fail(res, 404, "Timesheet not found");

  const entries = await fetchEntries(timesheet.id);
  const total_expected = Math.round(entries.reduce((sum, entry) => sum + Number(entry.expected_hours || 0), 0) * 100) / 100;
  const total_actual = Math.round(entries.reduce((sum, entry) => sum + Number(entry.actual_hours || 0), 0) * 100) / 100;
  return ok(res, {
    timesheet,
    entries,
    summary: {
      total_expected,
      total_actual,
      difference: Math.round((total_actual - total_expected) * 100) / 100,
      fte: calculateFTE(total_actual),
    },
  });
});

export const approveTimesheet = asyncHandler(async (req, res) => {
  const approved = await Timesheet.approve(req.params.id, userId(req));
  return ok(res, approved, "Timesheet approved; clinician notification queued");
});

export const rejectTimesheet = asyncHandler(async (req, res) => {
  const reason = String(req.body?.rejection_reason || req.body?.reason || "").trim();
  if (!reason) return fail(res, 400, "rejection_reason is required");
  const rejected = await Timesheet.reject(req.params.id, userId(req), reason);
  return ok(res, rejected, "Timesheet rejected; clinician notification queued");
});

export const getTimesheetHistory = asyncHandler(async (req, res) => {
  const history = await Timesheet.getHistory(req.query || {});
  return ok(res, history);
});

export const adminGetClinicianTimesheet = asyncHandler(async (req, res) => {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  const sheet = await Timesheet.findByClinicianMonth(req.params.clinicianId, month, year);
  if (!sheet) return ok(res, { timesheet: null, entries: [] });
  const entries = await fetchEntries(sheet.id);
  return ok(res, { timesheet: sheet, entries });
});

export const adminGetTimesheets = getTimesheetHistory;
export const adminGetPendingTimesheets = getPendingTimesheets;
export const adminGetTimesheetDetail = getTimesheetDetail;
export const adminApproveTimesheetPost = approveTimesheet;
export const adminRejectTimesheetPost = rejectTimesheet;
export const adminApproveTimesheet = asyncHandler(async (req, res) => {
  if (req.body?.action === "rejected") {
    const reason = String(req.body?.rejection_reason || req.body?.reason || "").trim();
    if (!reason) return fail(res, 400, "rejection_reason is required");
    const rejected = await Timesheet.reject(req.params.id, userId(req), reason);
    return ok(res, rejected, "Timesheet rejected; clinician notification queued");
  }
  const approved = await Timesheet.approve(req.params.id, userId(req));
  return ok(res, approved, "Timesheet approved; clinician notification queued");
});
