/**
 * Shared PostgreSQL JOIN fragments for Supabase (via pg pool / DATABASE_URL).
 * Never fall back to raw UUID in display name columns.
 */

/** Resolved practice/client name — practices + app_records + clients (never UUID) */
export const SQL_PRACTICE_NAME = `NULLIF(TRIM(COALESCE(
  p.name,
  pr.data->>'name',
  pr.data->>'practiceName',
  cl.data->>'name',
  cli.name
)), '')`;

/** Clinical system for rota_shifts (no clinical_system column on rs) */
export const SQL_ROTA_CLINICAL_SYSTEM = `NULLIF(TRIM(COALESCE(
  p.clinical_system,
  pr.data->>'clinicalSystem',
  pr.data->>'system',
  cl.data->>'clinicalSystem',
  cli.clinical_system
)), '')`;

/** Clinical system from shift row or linked practice/client */
export const SQL_CLINICAL_SYSTEM = (shiftAlias = "s") =>
  `NULLIF(TRIM(COALESCE(
    ${shiftAlias}.clinical_system,
    p.clinical_system,
    pr.data->>'clinicalSystem',
    pr.data->>'system',
    cl.data->>'clinicalSystem',
    cli.clinical_system
  )), '')`;

/** Standard joins for shift queries (practice_id column) */
export const SQL_PRACTICE_JOINS = (practiceIdCol = "s.practice_id") => `
  LEFT JOIN practices p ON p.id::text = ${practiceIdCol}::text
  LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = ${practiceIdCol}::text
  LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = ${practiceIdCol}::text
  LEFT JOIN clients cli ON cli.id::text = ${practiceIdCol}::text
`;

/** Standard joins for rota_shifts (surgery_id column) */
export const SQL_ROTA_PRACTICE_JOINS = (surgeryIdCol = "rs.surgery_id") => `
  LEFT JOIN practices p ON p.id::text = ${surgeryIdCol}::text
  LEFT JOIN app_records pr ON pr.model IN ('practice', 'Practice') AND pr.id::text = ${surgeryIdCol}::text
  LEFT JOIN app_records cl ON cl.model IN ('Client', 'client') AND cl.id::text = ${surgeryIdCol}::text
  LEFT JOIN clients cli ON cli.id::text = ${surgeryIdCol}::text
`;

/** Working shifts only — exclude leave types from list views */
export const SQL_WORKING_SHIFT_FILTER_SHIFTS = `AND s.status NOT IN ('annual_leave', 'sick', 'cppe', 'gap')`;

export const SQL_WORKING_SHIFT_FILTER_ROTA = `AND rs.shift_type NOT IN ('annual_leave', 'sick', 'cppe_training', 'bank_holiday', 'gap')`;
