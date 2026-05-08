/**
 * models/Shift.js — Module 5 (Rota & Shift Management)
 *
 * Represents a scheduled shift in the rota system.
 * Stored in PostgreSQL `shifts` table.
 *
 * Fields are aligned with CPS_Rota_Management_Specification.docx
 * and support both Mongo ObjectIds (clinician_id) and UUIDs (client_id).
 */

import { query } from "../config/db.js";

class Shift {
  /**
   * Create a new shift record.
   * @param {Object} data - Shift data
   * @returns {Promise<Object>} Created shift with all fields
   */
  static async create(data = {}) {
    const {
      // Core scheduling
      clinician_id = null,           // Mongo ObjectId (string) or UUID
      practice_id = null,            // ODS code (string) - REQUIRED
      client_id = null,              // Xero code or UUID
      date = null,                   // REQUIRED: ISO date string (YYYY-MM-DD)
      day_of_week = null,            // Mon, Tue, Wed, etc.
      start_time = null,             // HH:MM:SS
      end_time = null,               // HH:MM:SS
      hours = null,                  // Decimal: 8.0, 4.5, etc.
      clinical_system = null,        // EMIS, SystmOne, ICE, AccuRx, etc.
      status = "working",            // working | annual_leave | sick | cppe | cover | gap | cancelled

      // Cover-specific fields
      is_cover = false,              // Boolean: true if this is a cover shift
      project_code = null,           // COV1 for cover shifts
      service_code = null,           // PCN | EA | GPX | EAX
      original_gap_id = null,        // UUID: reference to gap shift this covers
      cover_reason = null,           // Why cover was needed

      // Tracking flags
      confirmation_received = false, // Client confirmed receipt
      access_request_needed = false, // System access needed
      client_informed = false,       // Client notified of clinician
      workstreams_notes = null,      // Notes on workstreams / systems
      clinician_notified = false,    // Clinician notified
      hours_to_cover = null,         // Hours originally needed
      hours_covered = null,          // Hours actually covered

      // Compliance flags
      compliance_checked = false,    // Pre-start checklist completed
      compliance_override_by = null, // UUID: who approved override
      compliance_override_reason = null, // Why compliance was overridden

      // Source tracking
      source = "manual",             // manual | leave_approval | sick_log | cppe_approval | auto_generated
      source_leave_id = null,        // UUID: reference to leave entry if source is leave
      created_by = null,             // UUID: user who created
    } = data;

    if (!practice_id || !date) {
      const err = new Error("practice_id and date are required");
      err.statusCode = 400;
      throw err;
    }

    const result = await query(
      `INSERT INTO shifts (
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id, created_by
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22,
        $23, $24, $25,
        $26, $27, $28
      ) RETURNING *`,
      [
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id, created_by,
      ]
    );

    return this._mapRow(result.rows[0]);
  }

  /**
   * Find shift by UUID.
   * @param {string} id - Shift UUID
   * @returns {Promise<Object|null>} Shift or null
   */
  static async findById(id) {
    const result = await query(
      `SELECT * FROM shifts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return this._mapRow(result.rows[0]);
  }

  /**
   * Find multiple shifts with filters.
   * @param {Object} filter - Filter object
   * @returns {Promise<Array>} Matching shifts
   */
  static async find(filter = {}) {
    let sql = `SELECT * FROM shifts WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filter.clinician_id) {
      sql += ` AND clinician_id = $${paramIndex++}`;
      params.push(filter.clinician_id);
    }
    if (filter.practice_id) {
      sql += ` AND practice_id = $${paramIndex++}`;
      params.push(filter.practice_id);
    }
    if (filter.client_id) {
      sql += ` AND client_id = $${paramIndex++}`;
      params.push(filter.client_id);
    }
    if (filter.date) {
      sql += ` AND date = $${paramIndex++}`;
      params.push(filter.date);
    }
    if (filter.status) {
      sql += ` AND status = $${paramIndex++}`;
      params.push(filter.status);
    }
    if (filter.is_cover !== undefined) {
      sql += ` AND is_cover = $${paramIndex++}`;
      params.push(filter.is_cover);
    }
    if (filter.dateRange) {
      const { start, end } = filter.dateRange;
      if (start) {
        sql += ` AND date >= $${paramIndex++}`;
        params.push(start);
      }
      if (end) {
        sql += ` AND date <= $${paramIndex++}`;
        params.push(end);
      }
    }

    sql += ` ORDER BY date ASC`;

    const result = await query(sql, params);
    return result.rows.map((row) => this._mapRow(row));
  }

  /**
   * Update shift by ID.
   * @param {string} id - Shift UUID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object|null>} Updated shift or null
   */
  static async findByIdAndUpdate(id, data = {}) {
    const updates = { ...data };
    delete updates.id;
    delete updates._id;
    delete updates.created_at;
    delete updates.created_by;

    const keys = Object.keys(updates);
    if (keys.length === 0) return this.findById(id);

    let sql = `UPDATE shifts SET updated_at = NOW()`;
    const params = [];
    let paramIndex = 1;

    for (const key of keys) {
      sql += `, ${key} = $${paramIndex++}`;
      params.push(updates[key]);
    }

    sql += ` WHERE id = $${paramIndex++} RETURNING *`;
    params.push(id);

    const result = await query(sql, params);
    return this._mapRow(result.rows[0]);
  }

  /**
   * Delete shift by ID.
   * @param {string} id - Shift UUID
   * @returns {Promise<boolean>} True if deleted
   */
  static async findByIdAndDelete(id) {
    const result = await query(
      `DELETE FROM shifts WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Count shifts by status.
   * @returns {Promise<Object>} Count by status
   */
  static async countByStatus() {
    const result = await query(
      `SELECT status, COUNT(*) as count FROM shifts GROUP BY status`
    );
    const counts = {};
    result.rows.forEach((row) => {
      counts[row.status] = parseInt(row.count, 10);
    });
    return counts;
  }

  /**
   * Find all gap shifts within next N days.
   * @param {number} days - Days ahead
   * @returns {Promise<Array>} Gap shifts
   */
  static async findGapsAhead(days = 14) {
    const endDate = new Date(Date.now() + days * 86400000)
      .toISOString()
      .slice(0, 10);

    const result = await query(
      `SELECT * FROM shifts
       WHERE status = 'gap'
         AND date >= CURRENT_DATE
         AND date <= $1
       ORDER BY date ASC`,
      [endDate]
    );

    return result.rows.map((row) => this._mapRow(row));
  }

  /**
   * Find urgent gaps (< 48 hours).
   * @returns {Promise<Array>} Urgent gaps
   */
  static async findUrgentGaps() {
    const urgentDate = new Date(Date.now() + 48 * 3600000)
      .toISOString()
      .slice(0, 10);

    const result = await query(
      `SELECT * FROM shifts
       WHERE status = 'gap'
         AND date >= CURRENT_DATE
         AND date <= $1
       ORDER BY date ASC`,
      [urgentDate]
    );

    return result.rows.map((row) => this._mapRow(row));
  }

  /**
   * Map database row to shift object.
   * @private
   */
  static _mapRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      _id: row.id, // Alias for compatibility
      clinician_id: row.clinician_id,
      practice_id: row.practice_id,
      client_id: row.client_id,
      date: row.date?.toISOString?.().slice(0, 10) || row.date,
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      hours: row.hours ? parseFloat(row.hours) : null,
      clinical_system: row.clinical_system,
      status: row.status,
      is_cover: row.is_cover,
      project_code: row.project_code,
      service_code: row.service_code,
      original_gap_id: row.original_gap_id,
      cover_reason: row.cover_reason,
      confirmation_received: row.confirmation_received,
      access_request_needed: row.access_request_needed,
      client_informed: row.client_informed,
      workstreams_notes: row.workstreams_notes,
      clinician_notified: row.clinician_notified,
      hours_to_cover: row.hours_to_cover ? parseFloat(row.hours_to_cover) : null,
      hours_covered: row.hours_covered ? parseFloat(row.hours_covered) : null,
      compliance_checked: row.compliance_checked,
      compliance_override_by: row.compliance_override_by,
      compliance_override_reason: row.compliance_override_reason,
      source: row.source,
      source_leave_id: row.source_leave_id,
      created_by: row.created_by,
      created_at: row.created_at?.toISOString() || row.created_at,
      updated_at: row.updated_at?.toISOString() || row.updated_at,
    };
  }

  /**
   * Lean query (read-only, faster).
   * @param {Object} filter - Filter object
   * @returns {Promise<Array>} Shifts without Mongoose overhead
   */
  static async findLean(filter = {}) {
    return this.find(filter);
  }
}

export default Shift;