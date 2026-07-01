// @ts-nocheck
/**
 * models/Shift.js — Module 5 (Rota & Shift Management)
 *
 * Stored in PostgreSQL `shifts` table.
 * practice_id / client_id / clinician_id → TEXT (not UUID)
 *  Added: hourly_rate, total_value
 */

import { query } from "../config/db.js";

class Shift {
  static async create(data = {}) {
    const {
      clinician_id               = null,
      practice_id                = null,
      client_id                  = null,
      date                       = null,
      day_of_week                = null,
      start_time                 = null,
      end_time                   = null,
      hours                      = null,
      hourly_rate                = null,   //  NEW
      total_value                = null,   //  NEW
      clinical_system            = null,
      status                     = "working",
      is_cover                   = false,
      project_code               = null,
      service_code               = null,
      original_gap_id            = null,
      cover_reason               = null,
      confirmation_received      = false,
      access_request_needed      = false,
      client_informed            = false,
      workstreams_notes          = null,
      clinician_notified         = false,
      hours_to_cover             = null,
      hours_covered              = null,
      compliance_checked         = false,
      compliance_override_by     = null,
      compliance_override_reason = null,
      source                     = "manual",
      source_leave_id            = null,
      created_by                 = null,
    } = data;

    if (!practice_id || !date) {
      const err = new Error("practice_id and date are required");
      err.statusCode = 400;
      throw err;
    }

    const result = await query(
      `INSERT INTO shifts (
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, hourly_rate, total_value,
        clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id, created_by
      ) VALUES (
        $1,  $2,  $3,  $4,  $5,
        $6,  $7,  $8,  $9,  $10,
        $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24,
        $25, $26, $27,
        $28, $29, $30
      ) RETURNING *`,
      [
        clinician_id, practice_id, client_id, date, day_of_week,
        start_time, end_time, hours, hourly_rate, total_value,
        clinical_system, status,
        is_cover, project_code, service_code, original_gap_id, cover_reason,
        confirmation_received, access_request_needed, client_informed, workstreams_notes,
        clinician_notified, hours_to_cover, hours_covered,
        compliance_checked, compliance_override_by, compliance_override_reason,
        source, source_leave_id, created_by,
      ]
    );

    return this._mapRow(result.rows[0]);
  }

  static async findById(id) {
    const result = await query(
      `SELECT * FROM shifts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return this._mapRow(result.rows[0]);
  }

  static async find(filter = {}) {
    let sql = `SELECT * FROM shifts WHERE 1=1`;
    const params = [];
    let i = 1;

    if (filter.clinician_id) { sql += ` AND clinician_id = $${i++}`; params.push(filter.clinician_id); }
    if (filter.practice_id)  { sql += ` AND practice_id  = $${i++}`; params.push(filter.practice_id);  }
    if (filter.client_id)    { sql += ` AND client_id    = $${i++}`; params.push(filter.client_id);    }
    if (filter.date)         { sql += ` AND date         = $${i++}`; params.push(filter.date);         }
    if (filter.status)       { sql += ` AND status       = $${i++}`; params.push(filter.status);       }
    if (filter.is_cover !== undefined) { sql += ` AND is_cover = $${i++}`; params.push(filter.is_cover); }

    if (filter.dateRange) {
      const { start, end } = filter.dateRange;
      if (start) { sql += ` AND date >= $${i++}`; params.push(start); }
      if (end)   { sql += ` AND date <  $${i++}`; params.push(end);   }
    }

    sql += ` ORDER BY date ASC`;
    const result = await query(sql, params);
    return result.rows.map((row) => this._mapRow(row));
  }

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
    let i = 1;

    for (const key of keys) {
      sql += `, ${key} = $${i++}`;
      params.push(updates[key]);
    }

    sql += ` WHERE id = $${i++} RETURNING *`;
    params.push(id);

    const result = await query(sql, params);
    return this._mapRow(result.rows[0]);
  }

  static async findByIdAndDelete(id) {
    const result = await query(
      `DELETE FROM shifts WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows.length > 0;
  }

  static async countByStatus() {
    const result = await query(
      `SELECT status, COUNT(*) as count FROM shifts GROUP BY status`
    );
    const counts = {};
    result.rows.forEach((row) => { counts[row.status] = parseInt(row.count, 10); });
    return counts;
  }

  static async findGapsAhead(days = 14) {
    const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const result = await query(
      `SELECT * FROM shifts
       WHERE status = 'gap' AND date >= CURRENT_DATE AND date <= $1
       ORDER BY date ASC`,
      [endDate]
    );
    return result.rows.map((row) => this._mapRow(row));
  }

  static async findUrgentGaps() {
    const urgentDate = new Date(Date.now() + 48 * 3600000).toISOString().slice(0, 10);
    const result = await query(
      `SELECT * FROM shifts
       WHERE status = 'gap' AND date >= CURRENT_DATE AND date <= $1
       ORDER BY date ASC`,
      [urgentDate]
    );
    return result.rows.map((row) => this._mapRow(row));
  }

  static _mapRow(row: any) {
    if (!row) return null;
    return {
      id:                         row.id,
      _id:                        row.id,
      clinician_id:               row.clinician_id,
      practice_id:                row.practice_id,
      client_id:                  row.client_id,
      date:                       row.date?.toISOString?.().slice(0, 10) || row.date,
      day_of_week:                row.day_of_week,
      start_time:                 row.start_time,
      end_time:                   row.end_time,
      hours:                      row.hours        ? parseFloat(row.hours)        : null,
      hourly_rate:                row.hourly_rate  ? parseFloat(row.hourly_rate)  : null,  // 
      total_value:                row.total_value  ? parseFloat(row.total_value)  : null,  // 
      clinical_system:            row.clinical_system,
      status:                     row.status,
      is_cover:                   row.is_cover,
      project_code:               row.project_code,
      service_code:               row.service_code,
      original_gap_id:            row.original_gap_id,
      cover_reason:               row.cover_reason,
      confirmation_received:      row.confirmation_received,
      access_request_needed:      row.access_request_needed,
      client_informed:            row.client_informed,
      workstreams_notes:          row.workstreams_notes,
      clinician_notified:         row.clinician_notified,
      hours_to_cover:             row.hours_to_cover ? parseFloat(row.hours_to_cover) : null,
      hours_covered:              row.hours_covered  ? parseFloat(row.hours_covered)  : null,
      compliance_checked:         row.compliance_checked,
      compliance_override_by:     row.compliance_override_by,
      compliance_override_reason: row.compliance_override_reason,
      source:                     row.source,
      source_leave_id:            row.source_leave_id,
      created_by:                 row.created_by,
      created_at:                 row.created_at?.toISOString() || row.created_at,
      updated_at:                 row.updated_at?.toISOString() || row.updated_at,
    };
  }

  static async findLean(filter = {}) {
    return this.find(filter);
  }
}

export default Shift;