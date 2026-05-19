/**
 * models/Timesheet.js
 * FIX: Replaced Supabase client with PostgreSQL query()
 * Reason: timesheets table now lives in PostgreSQL (created by ensureSchema in config/db.js)
 */

import { query } from "../config/db.js";

class Timesheet {
  static async findByClinicianMonth(clinician_id, month, year) {
    const result = await query(
      `SELECT * FROM timesheets
        WHERE clinician_id = $1 AND month = $2 AND year = $3
        LIMIT 1`,
      [clinician_id, month, year]
    );
    return result.rows[0] || null;
  }

  static async create(payload) {
    const { clinician_id, month, year, status = "draft" } = payload;
    const result = await query(
      `INSERT INTO timesheets (clinician_id, month, year, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clinician_id, month, year)
       DO UPDATE SET updated_at = timesheets.updated_at
       RETURNING *`,
      [clinician_id, month, year, status]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      `SELECT * FROM timesheets WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async updateStatus(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return this.findById(id);

    let sql = `UPDATE timesheets SET updated_at = NOW()`;
    const params = [];
    let i = 1;

    for (const key of keys) {
      sql += `, ${key} = $${i++}`;
      params.push(patch[key] ?? null);
    }

    sql += ` WHERE id = $${i} RETURNING *`;
    params.push(id);

    const result = await query(sql, params);
    return result.rows[0] || null;
  }

  static approve(id, approved_by) {
    return this.updateStatus(id, {
      status: "approved",
      approved_by,
      approved_at: new Date().toISOString(),
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
      invoice_sent: false,
    });
  }

  static reject(id, rejected_by, rejection_reason) {
    return this.updateStatus(id, {
      status: "rejected",
      rejected_by,
      rejected_at: new Date().toISOString(),
      rejection_reason,
    });
  }

  static async getPending() {
    const result = await query(
      `SELECT ts.*,
              COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name,
              c.clinician_type,
              c.contract_type
         FROM timesheets ts
         LEFT JOIN clinicians c ON c.id = ts.clinician_id
        WHERE ts.status = 'submitted'
        ORDER BY ts.submitted_at ASC`
    );
    return result.rows;
  }

  static async getHistory(filters = {}) {
    const page  = Math.max(Number(filters.page  || 1),  1);
    const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);

    const conditions = [];
    const params     = [];
    let i = 1;

    for (const key of ["month", "year", "clinician_id", "status"]) {
      if (filters[key] !== undefined && filters[key] !== "") {
        conditions.push(`ts.${key} = $${i++}`);
        params.push(filters[key]);
      }
    }

    const where  = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * limit;

    const countResult = await query(
      `SELECT COUNT(*) FROM timesheets ts ${where}`,
      params
    );

    const dataResult = await query(
      `SELECT ts.*,
              COALESCE(c.full_name, c.email, ts.clinician_id::text) AS clinician_name,
              c.clinician_type,
              c.contract_type
         FROM timesheets ts
         LEFT JOIN clinicians c ON c.id = ts.clinician_id
         ${where}
         ORDER BY ts.year DESC, ts.month DESC
         LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    return {
      items: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  }
}

export default Timesheet;