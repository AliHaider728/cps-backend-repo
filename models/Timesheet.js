import { getSupabaseClient } from "../lib/supabase.js";

const client = () => getSupabaseClient();

class Timesheet {
  static async findByClinicianMonth(clinician_id, month, year) {
    const { data, error } = await client()
      .from("timesheets")
      .select("*")
      .eq("clinician_id", clinician_id)
      .eq("month", month)
      .eq("year", year)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  static async create(payload) {
    const { data, error } = await client()
      .from("timesheets")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") {
        return this.findByClinicianMonth(payload.clinician_id, payload.month, payload.year);
      }
      throw error;
    }
    return data;
  }

  static async updateStatus(id, patch) {
    const { data, error } = await client()
      .from("timesheets")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
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
    const { data, error } = await client()
      .from("timesheets")
      .select("*, clinicians(full_name, clinician_type, contract_type)")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  static async getHistory(filters = {}) {
    const page = Math.max(Number(filters.page || 1), 1);
    const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);
    let query = client()
      .from("timesheets")
      .select("*, clinicians(full_name, clinician_type, contract_type)", { count: "exact" });

    ["month", "year", "clinician_id", "status"].forEach((key) => {
      if (filters[key]) query = query.eq(key, filters[key]);
    });

    const from = (page - 1) * limit;
    const { data, error, count } = await query
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    return { items: data || [], total: count || 0, page, limit };
  }
}

export default Timesheet;
