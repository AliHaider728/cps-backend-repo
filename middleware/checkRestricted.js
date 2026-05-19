import { getSupabaseClient } from "../lib/supabase.js";
import CoverRequest from "../models/CoverRequest.js";

const client = () => getSupabaseClient();

export const checkRestricted = async (req, res, next) => {
  try {
    const clinicianId = req.body?.clinician_id || req.body?.assigned_to || req.body?.clinicianId;
    let surgeryId = req.body?.surgery_id || req.body?.practice_id || req.body?.surgeryId;

    if (!surgeryId && req.params?.id) {
      const cover = await CoverRequest.findById(req.params.id);
      surgeryId = cover?.surgery_id || cover?.practice_id;
    }

    if (!clinicianId || !surgeryId) {
      return res.status(400).json({
        success: false,
        message: "clinician_id and surgery_id are required for restriction checks",
      });
    }

    const { data, error } = await client()
      .from("restricted_clinicians")
      .select("reason, notes")
      .eq("clinician_id", clinicianId)
      .in("entity_type", ["surgery", "practice"])
      .eq("entity_id", surgeryId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      return res.status(403).json({
        success: false,
        code: "RESTRICTED_CLINICIAN",
        message: "Clinician is restricted from this surgery",
        reason: data.reason || data.notes || "Clinician is restricted from this surgery",
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

export default checkRestricted;
