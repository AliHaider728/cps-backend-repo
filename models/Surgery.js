import { getSupabaseClient } from "../lib/supabase.js";

const client = () => getSupabaseClient();

class Surgery {
  static async findAll(filters = {}) {
    let query = client().from("surgeries").select("*").order("name");
    if (filters.is_active !== undefined) query = query.eq("is_active", filters.is_active);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  static async findById(id) {
    const { data, error } = await client().from("surgeries").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  static async findByPCN(pcn_id) {
    const { data, error } = await client().from("surgeries").select("*").eq("pcn_id", pcn_id).order("name");
    if (error) throw error;
    return data || [];
  }
}

export default Surgery;
