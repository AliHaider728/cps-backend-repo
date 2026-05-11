/**
 * controllers/timeEntryController.js — Rota Module (Clock-In / Clock-Out)
 *
 * Spec reference: CPS_Rota_Management_Specification §2.5 Clinician Personal Rota / Diary
 *
 * Endpoints (mounted at /api/time-entries by timeEntryRoutes.js):
 *   POST   /clock-in         → clinician clocks in for a shift
 *   POST   /clock-out        → clinician clocks out (calculates actual hours)
 *   GET    /active           → get own active entry (clinician) or by ?clinicianId (admin)
 *   GET    /                 → list entries — clinician sees own; admin can filter by ?clinicianId
 *   GET    /admin/summary    → super admin: all clinicians shift + hours totals this month
 */

import TimeEntry from "../models/TimeEntry.js";
import Clinician from "../models/Clinician.js";
import { logAudit } from "../middleware/auditLogger.js";
import { query } from "../config/db.js";

const ok   = (res, data, message = "OK", status = 200) =>
  res.status(status).json({ success: true, data, message });

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

/* ─── Resolve clinician ID from user ──────────────────────────────────────── */
async function resolveClinicianId(user) {
  if (user.role !== "clinician") return null;
  // The clinician record stores user as its linked user id
  const result = await query(
    `SELECT id, data->>'user' AS user_id
     FROM app_records
     WHERE model = 'Clinician'
     AND data->>'user' = $1
     LIMIT 1`,
    [String(user._id || user.id)]
  );
  return result.rows[0]?.id || null;
}

/* ─── CLOCK IN ──────────────────────────────────────────────────────────────── */
export const clockIn = async (req, res, next) => {
  try {
    const { shiftId } = req.body || {};

    const clinicianId = await resolveClinicianId(req.user);
    if (!clinicianId) {
      return fail(res, 403, "Only clinicians can clock in");
    }

    const entry = await TimeEntry.clockIn({ clinicianId, shiftId: shiftId || null });

    await logAudit(req, "CLOCK_IN", "TimeEntry", {
      after: { clinicianId, shiftId: shiftId || null, clockIn: entry.clock_in },
    });

    return ok(res, entry, "Clocked in successfully", 201);
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

/* ─── CLOCK OUT ─────────────────────────────────────────────────────────────── */
export const clockOut = async (req, res, next) => {
  try {
    const clinicianId = await resolveClinicianId(req.user);
    if (!clinicianId) {
      return fail(res, 403, "Only clinicians can clock out");
    }

    const entry = await TimeEntry.clockOut(clinicianId);

    await logAudit(req, "CLOCK_OUT", "TimeEntry", {
      after: {
        clinicianId,
        clockOut:    entry.clock_out,
        actualHours: entry.actual_hours,
      },
    });

    return ok(res, entry, "Clocked out successfully");
  } catch (err) {
    if (err.statusCode) return fail(res, err.statusCode, err.message);
    next(err);
  }
};

/* ─── ACTIVE ENTRY ──────────────────────────────────────────────────────────── */
export const getActive = async (req, res, next) => {
  try {
    let clinicianId;

    if (req.user.role === "clinician") {
      clinicianId = await resolveClinicianId(req.user);
      if (!clinicianId) return ok(res, null, "No clinician profile found");
    } else {
      // Admin can query any clinician's active entry
      clinicianId = req.query.clinicianId || null;
      if (!clinicianId) return fail(res, 400, "clinicianId query param required for admin");
    }

    const entry = await TimeEntry.findActive(clinicianId);
    return ok(res, entry || null);
  } catch (err) {
    next(err);
  }
};

/* ─── LIST ENTRIES ──────────────────────────────────────────────────────────── */
export const listEntries = async (req, res, next) => {
  try {
    const { from, to, status, limit } = req.query;

    let clinicianId;
    if (req.user.role === "clinician") {
      clinicianId = await resolveClinicianId(req.user);
      if (!clinicianId) return ok(res, []);
    } else {
      clinicianId = req.query.clinicianId || null;
    }

    const entries = await TimeEntry.list({
      clinicianId,
      from:   from  || null,
      to:     to    || null,
      status: status || null,
      limit:  limit ? parseInt(limit, 10) : 200,
    });

    return ok(res, entries);
  } catch (err) {
    next(err);
  }
};

/* ─── ADMIN SUMMARY ─────────────────────────────────────────────────────────── */
export const getAdminSummary = async (req, res, next) => {
  try {
    // Time-entry stats this month
    const timeStats = await TimeEntry.adminSummary();
    const timeMap   = {};
    for (const row of timeStats) {
      timeMap[row.clinician_id] = {
        totalEntries:       Number(row.total_entries),
        totalActualHours:   Number(row.total_actual_hours),
        currentlyClockedIn: Number(row.currently_clocked_in) > 0,
      };
    }

    // All clinicians
    const clinicians = await query(
      `SELECT id, data FROM app_records WHERE model = 'Clinician' ORDER BY data->>'fullName'`
    );

    // Shifts this month per clinician
    const shiftsResult = await query(
      `SELECT clinician_id,
              COUNT(*)                               AS total_shifts,
              COALESCE(SUM(hours), 0)               AS total_planned_hours
       FROM shifts
       WHERE date >= date_trunc('month', NOW())
         AND date < date_trunc('month', NOW()) + INTERVAL '1 month'
       GROUP BY clinician_id`
    );
    const shiftMap = {};
    for (const row of shiftsResult.rows) {
      shiftMap[row.clinician_id] = {
        totalShifts:      Number(row.total_shifts),
        totalPlannedHours: Number(row.total_planned_hours),
      };
    }

    // Pending leave this month
    const pendingLeave = await query(
      `SELECT COUNT(*) AS pending
       FROM app_records
       WHERE model = 'ClinicianLeaveEntry'
         AND data->>'approved' = 'false'
         AND (data->>'startDate')::date >= date_trunc('month', NOW())`
    );

    // Build per-clinician summary
    const clinicianSummaries = clinicians.rows.map((row) => {
      const d = row.data || {};
      const ts = timeMap[row.id] || { totalEntries: 0, totalActualHours: 0, currentlyClockedIn: false };
      const ss = shiftMap[row.id] || { totalShifts: 0, totalPlannedHours: 0 };
      return {
        clinicianId:       row.id,
        fullName:          d.fullName || "",
        clinicianType:     d.clinicianType || "",
        contractType:      d.contractType || "",
        isActive:          d.isActive !== false,
        totalShiftsMonth:  ss.totalShifts,
        plannedHoursMonth: ss.totalPlannedHours,
        actualHoursMonth:  ts.totalActualHours,
        currentlyClockedIn: ts.currentlyClockedIn,
      };
    });

    // Aggregate totals
    const totalShifts = clinicianSummaries.reduce((s, c) => s + c.totalShiftsMonth, 0);
    const totalPlanned = clinicianSummaries.reduce((s, c) => s + c.plannedHoursMonth, 0);
    const totalActual  = clinicianSummaries.reduce((s, c) => s + c.actualHoursMonth, 0);
    const totalClockedIn = clinicianSummaries.filter((c) => c.currentlyClockedIn).length;

    return ok(res, {
      month: new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
      totals: {
        clinicians:        clinicianSummaries.length,
        shiftsThisMonth:   totalShifts,
        plannedHours:      Math.round(totalPlanned * 10) / 10,
        actualHours:       Math.round(totalActual * 10) / 10,
        pendingLeave:      Number(pendingLeave.rows[0]?.pending || 0),
        currentlyClockedIn: totalClockedIn,
      },
      clinicians: clinicianSummaries,
    });
  } catch (err) {
    next(err);
  }
};
