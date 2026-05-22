import { query } from "../config/db.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL fragments — never fall back to raw UUID in name columns */
export const PRACTICE_NAME_SQL = `NULLIF(TRIM(COALESCE(
  p.name,
  pr.data->>'name',
  pr.data->>'practiceName',
  cl.data->>'name'
)), '')`;

export const CLINICAL_SYSTEM_SQL = `NULLIF(TRIM(COALESCE(
  s.clinical_system,
  rs.clinical_system,
  p.clinical_system,
  pr.data->>'clinicalSystem',
  pr.data->>'system',
  cl.data->>'clinicalSystem',
  cl.data->>'system'
)), '')`;

export const PRACTICE_JOIN_SQL = `
  LEFT JOIN practices p ON p.id::text = COALESCE(rs.surgery_id::text, s.practice_id::text)
  LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = COALESCE(rs.surgery_id::text, s.practice_id::text)
  LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = COALESCE(rs.surgery_id::text, s.practice_id::text)
`;

export async function loadPracticeMeta(practiceId) {
  const pid = String(practiceId || "").trim();
  if (!pid) return null;

  const result = await query(
    `SELECT NULLIF(TRIM(COALESCE(
              p.name,
              pr.data->>'name',
              pr.data->>'practiceName',
              cl.data->>'name'
            )), '') AS name,
            pr.data AS practice_data,
            cl.data AS client_data,
            p.id
       FROM (SELECT $1::text AS pid) x
       LEFT JOIN practices p ON p.id::text = x.pid
       LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = x.pid
       LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = x.pid`,
    [pid]
  );

  const row = result.rows[0];
  if (!row) return { id: pid, name: null };

  const data = { ...(row.client_data || {}), ...(row.practice_data || {}) };
  const contractType = String(
    data.contractType || data.contract_type || data.type || "PCN"
  ).toUpperCase();

  return {
    id: pid,
    name: row.name || null,
    contractType,
    clinical_system:
      data.clinicalSystem || data.clinical_system || data.system || null,
  };
}

/** Cover shift defaults per Blueprint Rule #05 */
export function serviceCodeForPracticeType(contractOrType = "PCN") {
  const t = String(contractOrType).toUpperCase();
  if (t === "EA" || t.includes("ENHANCED")) return "EA";
  if (t === "GP" || t === "DIRECT") return "GP";
  return "PCN";
}

export async function applyCoverShiftDefaults(payload = {}, practiceId) {
  const isCover =
    payload.is_cover === true ||
    payload.is_cover === "true" ||
    String(payload.status || "").toLowerCase() === "cover";

  if (!isCover) return payload;

  const meta = await loadPracticeMeta(practiceId || payload.practice_id);
  const serviceCode = serviceCodeForPracticeType(meta?.contractType);

  return {
    ...payload,
    is_cover: true,
    status: "cover",
    project_code: "COVER",
    service_code: payload.service_code
      ? String(payload.service_code).toUpperCase()
      : serviceCode,
    clinical_system:
      payload.clinical_system || meta?.clinical_system || null,
  };
}

export function stripUuidDisplayName(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (UUID_RE.test(s)) return null;
  return s;
}
