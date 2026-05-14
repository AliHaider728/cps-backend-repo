import { query } from "../config/db.js";
import { logAudit } from "../middleware/auditLogger.js";
import { v4 as uuidv4 } from "uuid";

const MODEL = "time_entry";

const ok = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, data, message });
const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

function mapRow(row) {
  if (!row) return null;
  return { id: row.id, ...(row.data || {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

export const getActiveEntry = async (req, res, next) => {
  try {
    const userId = String(req.user._id || req.user.id || "");
    if (!userId) return fail(res, 400, "User ID missing from token");

    const result = await query(
      `SELECT id, data, created_at, updated_at
       FROM app_records
       WHERE model = $1
         AND data->>'user_id' = $2
         AND data->>'status' = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [MODEL, userId]
    );

    return ok(res, result.rows[0] ? mapRow(result.rows[0]) : null, "Active entry");
  } catch (err) {
    next(err);
  }
};

export const clockIn = async (req, res, next) => {
  try {
    const userId = String(req.user._id || req.user.id || "");
    const clinicianId = req.user.clinicianId || null;

    if (!userId) return fail(res, 400, "User ID missing from token");

    const existing = await query(
      `SELECT id FROM app_records
       WHERE model = $1 AND data->>'user_id' = $2 AND data->>'status' = 'active'
       LIMIT 1`,
      [MODEL, userId]
    );
    if (existing.rows.length > 0) {
      return fail(res, 409, "Already clocked in. Please clock out first.");
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    const payload = {
      clinician_id:  clinicianId,
      user_id:       userId,
      clock_in:      now,
      clock_out:     null,
      planned_hours: req.body?.planned_hours || null,
      actual_hours:  null,
      status:        "active",
      notes:         req.body?.notes || "",
      created_by:    userId,
      createdAt:     now,
      updatedAt:     now,
    };

    const result = await query(
      `INSERT INTO app_records (model, id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       RETURNING id, data, created_at, updated_at`,
      [MODEL, id, JSON.stringify(payload)]
    );

    const entry = mapRow(result.rows[0]);

    await logAudit(req, "CLOCK_IN", "TimeEntry", {
      resourceId: entry.id,
      detail:     `Clinician clocked in at ${now}`,
      after:      entry,
    });

    return ok(res, entry, "Clocked in successfully", 201);
  } catch (err) {
    next(err);
  }
};

export const clockOut = async (req, res, next) => {
  try {
    const userId = String(req.user._id || req.user.id || "");

    if (!userId) return fail(res, 400, "User ID missing from token");

    const active = await query(
      `SELECT id, data FROM app_records
       WHERE model = $1 AND data->>'user_id' = $2 AND data->>'status' = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [MODEL, userId]
    );
    if (!active.rows.length) {
      return fail(res, 404, "No active shift found. Please clock in first.");
    }

    const row = active.rows[0];
    const entry = { id: row.id, ...(row.data || {}) };
    const now = new Date();
    const clockInTime = new Date(entry.clock_in);
    const diffMs = now.getTime() - clockInTime.getTime();
    const actualHours = Math.round((diffMs / 3_600_000) * 100) / 100;

    const patch = {
      ...entry,
      clock_out:    now.toISOString(),
      actual_hours: actualHours,
      status:       "completed",
      updatedAt:    now.toISOString(),
    };

    const result = await query(
      `UPDATE app_records
       SET data = $3::jsonb, updated_at = NOW()
       WHERE model = $1 AND id = $2
       RETURNING id, data, created_at, updated_at`,
      [MODEL, row.id, JSON.stringify(patch)]
    );

    const updated = mapRow(result.rows[0]);

    await logAudit(req, "CLOCK_OUT", "TimeEntry", {
      resourceId: updated.id,
      detail:     `Clocked out. Duration: ${actualHours}h`,
      after:      updated,
    });

    return ok(res, updated, "Clocked out successfully");
  } catch (err) {
    next(err);
  }
};

export const getTimeEntries = async (req, res, next) => {
  try {
    const userId = String(req.user._id || req.user.id || "");
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const offset = parseInt(req.query.offset || "0", 10);

    if (!userId) return fail(res, 400, "User ID missing from token");

    const result = await query(
      `SELECT id, data, created_at, updated_at
       FROM app_records
       WHERE model = $1 AND data->>'user_id' = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [MODEL, userId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) FROM app_records WHERE model = $1 AND data->>'user_id' = $2`,
      [MODEL, userId]
    );

    return ok(res, {
      entries: result.rows.map(mapRow),
      total:   parseInt(countResult.rows[0].count, 10),
      limit,
      offset,
    }, "Time entries");
  } catch (err) {
    next(err);
  }
};

export const getAdminSummary = async (req, res, next) => {
  try {
    const timeStats = await query(
      `SELECT
         data->>'clinician_id' AS clinician_id,
         COUNT(*) AS total_entries,
         COALESCE(SUM(COALESCE(NULLIF(data->>'actual_hours', '')::numeric, 0)), 0) AS total_actual_hours,
         COUNT(*) FILTER (WHERE data->>'status' = 'active') AS currently_clocked_in
       FROM app_records
       WHERE model = $1
         AND COALESCE(NULLIF(data->>'clock_in', '')::timestamptz, created_at) >= date_trunc('month', NOW())
       GROUP BY data->>'clinician_id'`,
      [MODEL]
    );

    const timeMap = {};
    for (const row of timeStats.rows) {
      if (!row.clinician_id) continue;
      timeMap[row.clinician_id] = {
        totalEntries:       Number(row.total_entries || 0),
        totalActualHours:   Number(row.total_actual_hours || 0),
        currentlyClockedIn: Number(row.currently_clocked_in || 0) > 0,
      };
    }

    const clinicians = await query(
      `SELECT id, data FROM app_records WHERE model = 'Clinician' ORDER BY data->>'fullName'`
    );

    const shiftsResult = await query(
      `SELECT clinician_id,
              COUNT(*) AS total_shifts,
              COALESCE(SUM(hours), 0) AS total_planned_hours
       FROM shifts
       WHERE date >= date_trunc('month', NOW())
         AND date < date_trunc('month', NOW()) + INTERVAL '1 month'
       GROUP BY clinician_id`
    );

    const shiftMap = {};
    for (const row of shiftsResult.rows) {
      shiftMap[row.clinician_id] = {
        totalShifts:       Number(row.total_shifts || 0),
        totalPlannedHours: Number(row.total_planned_hours || 0),
      };
    }

    const pendingLeave = await query(
      `SELECT COUNT(*) AS pending
       FROM app_records
       WHERE model = 'ClinicianLeaveEntry'
         AND data->>'approved' = 'false'
         AND (data->>'startDate')::date >= date_trunc('month', NOW())`
    );

    const clinicianSummaries = clinicians.rows.map((row) => {
      const data = row.data || {};
      const time = timeMap[row.id] || { totalEntries: 0, totalActualHours: 0, currentlyClockedIn: false };
      const shifts = shiftMap[row.id] || { totalShifts: 0, totalPlannedHours: 0 };
      return {
        clinicianId:        row.id,
        fullName:           data.fullName || data.name || "",
        clinicianType:      data.clinicianType || "",
        contractType:       data.contractType || "",
        isActive:           data.isActive !== false,
        totalShiftsMonth:   shifts.totalShifts,
        plannedHoursMonth:  shifts.totalPlannedHours,
        actualHoursMonth:   time.totalActualHours,
        currentlyClockedIn: time.currentlyClockedIn,
      };
    });

    const totalShifts = clinicianSummaries.reduce((sum, clinician) => sum + clinician.totalShiftsMonth, 0);
    const totalPlanned = clinicianSummaries.reduce((sum, clinician) => sum + clinician.plannedHoursMonth, 0);
    const totalActual = clinicianSummaries.reduce((sum, clinician) => sum + clinician.actualHoursMonth, 0);
    const totalClockedIn = clinicianSummaries.filter((clinician) => clinician.currentlyClockedIn).length;

    return ok(res, {
      month: new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
      totals: {
        clinicians:         clinicianSummaries.length,
        shiftsThisMonth:    totalShifts,
        plannedHours:       Math.round(totalPlanned * 10) / 10,
        actualHours:        Math.round(totalActual * 10) / 10,
        pendingLeave:       Number(pendingLeave.rows[0]?.pending || 0),
        currentlyClockedIn: totalClockedIn,
      },
      clinicians: clinicianSummaries,
    }, "Time entry admin summary");
  } catch (err) {
    next(err);
  }
};
