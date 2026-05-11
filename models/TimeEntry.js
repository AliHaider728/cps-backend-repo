/**
 * models/TimeEntry.js — Rota Module (Clock-In / Clock-Out)
 *
 * Stored in PostgreSQL `time_entries` table.
 * Follows same pattern as models/Shift.js
 */

import { query } from "../config/db.js";

class TimeEntry {
  /**
   * Clock in — insert a new active entry.
   * Throws 409 if clinician already has an active entry.
   */
  static async clockIn({ clinicianId, shiftId = null }) {
    if (!clinicianId) {
      const err = new Error("clinicianId is required");
      err.statusCode = 400;
      throw err;
    }

    // Check for existing active entry
    const existing = await query(
      `SELECT id FROM time_entries WHERE clinician_id = $1 AND status = 'active' LIMIT 1`,
      [clinicianId]
    );
    if (existing.rows.length > 0) {
      const err = new Error("Already clocked in. Please clock out first.");
      err.statusCode = 409;
      throw err;
    }

    const result = await query(
      `INSERT INTO time_entries (clinician_id, shift_id, clock_in, status)
       VALUES ($1, $2, NOW(), 'active')
       RETURNING *`,
      [clinicianId, shiftId || null]
    );

    // Mark shift as active
    if (shiftId) {
      await query(
        `UPDATE shifts SET status = 'working', updated_at = NOW() WHERE id = $1`,
        [shiftId]
      );
    }

    return result.rows[0];
  }

  /**
   * Clock out — close the active entry, calculate actual_hours.
   * Returns the updated entry.
   */
  static async clockOut(clinicianId) {
    if (!clinicianId) {
      const err = new Error("clinicianId is required");
      err.statusCode = 400;
      throw err;
    }

    const active = await query(
      `SELECT * FROM time_entries WHERE clinician_id = $1 AND status = 'active' LIMIT 1`,
      [clinicianId]
    );
    if (active.rows.length === 0) {
      const err = new Error("No active clock-in found. Please clock in first.");
      err.statusCode = 404;
      throw err;
    }

    const entry = active.rows[0];
    const nowMs = Date.now();
    const inMs  = new Date(entry.clock_in).getTime();
    const diffHours = Math.round(((nowMs - inMs) / 3_600_000) * 100) / 100;

    const result = await query(
      `UPDATE time_entries
       SET clock_out = NOW(), actual_hours = $1, status = 'completed'
       WHERE id = $2
       RETURNING *`,
      [diffHours, entry.id]
    );

    return result.rows[0];
  }

  /**
   * Get the current active entry for a clinician (null if none).
   */
  static async findActive(clinicianId) {
    const result = await query(
      `SELECT te.*, s.date AS shift_date, s.start_time, s.end_time, s.hours AS planned_hours
       FROM time_entries te
       LEFT JOIN shifts s ON s.id = te.shift_id
       WHERE te.clinician_id = $1 AND te.status = 'active'
       LIMIT 1`,
      [clinicianId]
    );
    return result.rows[0] || null;
  }

  /**
   * List entries — optional filters: clinicianId, from, to, status.
   */
  static async list({ clinicianId, from, to, status, limit = 100 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (clinicianId) {
      conditions.push(`te.clinician_id = $${idx++}`);
      params.push(clinicianId);
    }
    if (from) {
      conditions.push(`te.clock_in >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`te.clock_in <= $${idx++}`);
      params.push(to);
    }
    if (status) {
      conditions.push(`te.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `SELECT te.*, s.date AS shift_date, s.start_time, s.end_time, s.hours AS planned_hours
       FROM time_entries te
       LEFT JOIN shifts s ON s.id = te.shift_id
       ${where}
       ORDER BY te.clock_in DESC
       LIMIT $${idx}`,
      [...params, limit]
    );
    return result.rows;
  }

  /**
   * Admin summary — total shifts + actual hours per clinician for current month.
   */
  static async adminSummary() {
    const result = await query(
      `SELECT
         clinician_id,
         COUNT(*)                                         AS total_entries,
         COALESCE(SUM(actual_hours), 0)                  AS total_actual_hours,
         COUNT(*) FILTER (WHERE status = 'active')       AS currently_clocked_in
       FROM time_entries
       WHERE clock_in >= date_trunc('month', NOW())
       GROUP BY clinician_id`
    );
    return result.rows;
  }

  /**
   * Shift-level summary — for a given shift, return total clocked hours.
   */
  static async hoursForShift(shiftId) {
    const result = await query(
      `SELECT COALESCE(SUM(actual_hours), 0) AS total_hours
       FROM time_entries
       WHERE shift_id = $1 AND status = 'completed'`,
      [shiftId]
    );
    return Number(result.rows[0]?.total_hours || 0);
  }
}

export default TimeEntry;
