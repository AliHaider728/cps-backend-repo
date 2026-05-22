import { query } from "../config/db.js";

/** Per-clinician shift count from `shifts` + `rota_shifts` (excludes cancelled/gap). */
export async function fetchShiftCountsByClinician() {
  const { rows } = await query(`
    SELECT TRIM(cid) AS clinician_id, SUM(cnt)::int AS shift_count
    FROM (
      SELECT TRIM(COALESCE(clinician_id::text, '')) AS cid, COUNT(*)::bigint AS cnt
        FROM shifts
       WHERE COALESCE(TRIM(clinician_id::text), '') <> ''
         AND status NOT IN ('cancelled', 'gap')
       GROUP BY 1
      UNION ALL
      SELECT TRIM(COALESCE(clinician_id::text, '')) AS cid, COUNT(*)::bigint
        FROM rota_shifts
       WHERE COALESCE(TRIM(clinician_id::text), '') <> ''
       GROUP BY 1
    ) combined
   WHERE TRIM(cid) <> ''
   GROUP BY TRIM(cid)
  `);

  return new Map(rows.map((r) => [String(r.clinician_id), Number(r.shift_count) || 0]));
}
