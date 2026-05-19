import { getSupabaseClient } from "../lib/supabase.js";
import { calculateHours } from "../lib/timesheetCalc.js";

const client = () => getSupabaseClient();

class TimesheetEntry {
  static async findByTimesheet(timesheet_id) {
    const { data, error } = await client()
      .from("timesheet_entries")
      .select("*")
      .eq("timesheet_id", timesheet_id)
      .order("shift_date", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  static async upsert(payload) {
    const { data, error } = await client()
      .from("timesheet_entries")
      .upsert(payload, { onConflict: "timesheet_id,clinician_id,surgery_id,shift_date" })
      .select("*");
    if (error) throw error;
    return Array.isArray(data) ? data : [data];
  }

  static async updateHours(id, { start_time, end_time, notes }) {
    const actual_hours = calculateHours(start_time, end_time);
    const { data, error } = await client()
      .from("timesheet_entries")
      .update({ start_time, end_time, notes, actual_hours, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  static async calculateTotalHours(timesheet_id) {
    const entries = await this.findByTimesheet(timesheet_id);
    return Math.round(entries.reduce((sum, entry) => sum + Number(entry.actual_hours || 0), 0) * 100) / 100;
  }
}

export default TimesheetEntry;
