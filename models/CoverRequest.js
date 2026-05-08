import { query } from "../config/db.js";

class CoverRequest {
  static async create(data = {}) {
    const {
      shift_id = null,
      practice_id = null,
      practice_name = null,
      date = null,
      start_time = null,
      end_time = null,
      hours_needed = null,
      clinical_system = null,
      status = "open",
      filled_by = null,
      email_sent_at = null,
    } = data;

    if (!shift_id || !practice_id || !date) {
      const err = new Error("shift_id, practice_id, and date are required");
      err.statusCode = 400;
      throw err;
    }

    const result = await query(
      `INSERT INTO cover_requests (
        shift_id, practice_id, practice_name, date, start_time, end_time,
        hours_needed, clinical_system, status, filled_by, email_sent_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11
      ) RETURNING *`,
      [
        shift_id,
        practice_id,
        practice_name,
        date,
        start_time,
        end_time,
        hours_needed,
        clinical_system,
        status,
        filled_by,
        email_sent_at,
      ]
    );

    return this._mapRow(result.rows[0]);
  }

  static async findOpenByShiftId(shiftId) {
    const result = await query(
      `SELECT * FROM cover_requests WHERE shift_id = $1 AND status = 'open' LIMIT 1`,
      [shiftId]
    );
    return this._mapRow(result.rows[0]);
  }

  static async markEmailSent(id) {
    const result = await query(
      `UPDATE cover_requests SET email_sent_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return this._mapRow(result.rows[0]);
  }

  static _mapRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      shift_id: row.shift_id,
      practice_id: row.practice_id,
      practice_name: row.practice_name,
      date: row.date?.toISOString?.().slice(0, 10) || row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      hours_needed: row.hours_needed ? parseFloat(row.hours_needed) : null,
      clinical_system: row.clinical_system,
      status: row.status,
      filled_by: row.filled_by,
      email_sent_at: row.email_sent_at?.toISOString?.() || row.email_sent_at,
      created_at: row.created_at?.toISOString?.() || row.created_at,
    };
  }
}

export default CoverRequest;
