import { getSupabaseClient } from "../lib/supabase.js";
import { query as pgQuery } from "../config/db.js";

const client = () => getSupabaseClient();

class CoverRequest {
  static async getOpen() {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .select("*, surgeries(name), clinicians(full_name)")
        .eq("status", "open")
        .order("shift_date", { ascending: true });
      if (error) throw error;
      return data || [];
    } catch {
      const result = await pgQuery("SELECT * FROM cover_requests WHERE status = 'open' ORDER BY date ASC");
      return result.rows.map(this._mapLegacyRow);
    }
  }

  static async create(payload = {}) {
    const row = {
      rota_shift_id: payload.rota_shift_id || payload.shift_id || null,
      surgery_id: payload.surgery_id || payload.practice_id,
      shift_date: payload.shift_date || payload.date,
      shift_start: payload.shift_start || payload.start_time || null,
      shift_end: payload.shift_end || payload.end_time || null,
      required_skills: payload.required_skills || [],
      service_code: payload.service_code || null,
      project_code: payload.project_code || "COVER",
      status: payload.status || "open",
      created_by: payload.created_by || null,
    };

    try {
      const { data, error } = await client()
        .from("cover_requests")
        .insert(row)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    } catch {
      const result = await pgQuery(
        `INSERT INTO cover_requests (
          shift_id, practice_id, practice_name, date, start_time, end_time,
          hours_needed, clinical_system, status, filled_by, email_sent_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          payload.shift_id || payload.rota_shift_id || null,
          payload.practice_id || payload.surgery_id,
          payload.practice_name || null,
          payload.date || payload.shift_date,
          payload.start_time || payload.shift_start || null,
          payload.end_time || payload.shift_end || null,
          payload.hours_needed || null,
          payload.clinical_system || null,
          payload.status || "open",
          payload.filled_by || null,
          payload.email_sent_at || null,
        ]
      );
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static async assign(id, clinician_id, assigned_by) {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .update({
          assigned_to: clinician_id,
          assigned_by,
          assigned_at: new Date().toISOString(),
          status: "assigned",
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    } catch {
      const result = await pgQuery(
        "UPDATE cover_requests SET filled_by = $1, status = 'filled' WHERE id = $2 RETURNING *",
        [clinician_id, id]
      );
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static async updateStatus(id, status) {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .update({ status })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    } catch {
      const legacyStatus = status === "assigned" ? "filled" : status;
      const result = await pgQuery("UPDATE cover_requests SET status = $1 WHERE id = $2 RETURNING *", [legacyStatus, id]);
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static async findById(id) {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch {
      const result = await pgQuery("SELECT * FROM cover_requests WHERE id = $1 LIMIT 1", [id]);
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static async findOpenByShiftId(shiftId) {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .select("*")
        .eq("rota_shift_id", shiftId)
        .eq("status", "open")
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch {
      const result = await pgQuery("SELECT * FROM cover_requests WHERE shift_id = $1 AND status = 'open' LIMIT 1", [shiftId]);
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static async markEmailSent(id) {
    try {
      const { data, error } = await client()
        .from("cover_requests")
        .update({ email_sent_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    } catch {
      const result = await pgQuery("UPDATE cover_requests SET email_sent_at = NOW() WHERE id = $1 RETURNING *", [id]);
      return this._mapLegacyRow(result.rows[0]);
    }
  }

  static _mapLegacyRow(row) {
    if (!row) return null;
    return {
      ...row,
      rota_shift_id: row.shift_id,
      surgery_id: row.practice_id,
      shift_date: row.date?.toISOString?.().slice(0, 10) || row.date,
      shift_start: row.start_time,
      shift_end: row.end_time,
      assigned_to: row.filled_by,
      surgeries: row.practice_name ? { name: row.practice_name } : undefined,
    };
  }
}

export default CoverRequest;
