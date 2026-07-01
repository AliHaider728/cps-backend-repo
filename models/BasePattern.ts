// @ts-nocheck
import { getSupabaseClient } from "../lib/supabase.js";

const client = () => getSupabaseClient();

class BasePattern {
  static async findByClinician(clinician_id) {
    const { data, error } = await client()
      .from("base_patterns")
      .select("*")
      .eq("clinician_id", clinician_id)
      .eq("is_active", true)
      .order("day_of_week");
    if (error) throw error;
    return data || [];
  }

  static async findBySurgery(surgery_id) {
    const { data, error } = await client()
      .from("base_patterns")
      .select("*")
      .eq("surgery_id", surgery_id)
      .eq("is_active", true)
      .order("day_of_week");
    if (error) throw error;
    return data || [];
  }

  static async create(payload) {
    const { data, error } = await client().from("base_patterns").insert(payload).select("*").single();
    if (error) throw error;
    return data;
  }

  static async update(id, patch) {
    const { data, error } = await client()
      .from("base_patterns")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  static deactivate(id) {
    return this.update(id, { is_active: false });
  }
}

export default BasePattern;
