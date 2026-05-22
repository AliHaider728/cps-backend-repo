import { query } from "../config/db.js";
import { normalizeId } from "../lib/ids.js";
import { assertClinicianAccess } from "../lib/clinicianAccess.js";

const toId = (v) => normalizeId(v);

const practiceNameSql = `
  COALESCE(
    cl.name,
    (SELECT COALESCE(pr.data->>'name', pr.data->>'practiceName')
       FROM app_records pr
      WHERE pr.model IN ('practice', 'Practice', 'Client', 'client')
        AND pr.id::text = TRIM(pm.practice_id::text)
      LIMIT 1),
    (SELECT p.name FROM practices p WHERE p.id::text = TRIM(pm.practice_id::text) LIMIT 1)
  )
`;

export const getProjectMappings = async (req, res, next) => {
  try {
    const clinicianId = await assertClinicianAccess(req, req.params.id);
    const { rows } = await query(
      `SELECT pm.id, pm.clinician_id, pm.project, pm.practice_id, pm.type,
              pm.rate, pm.rate_type, pm.vat_percentage, pm.created_at,
              ${practiceNameSql} AS practice_name
         FROM project_mappings pm
         LEFT JOIN clients cl ON cl.id::text = TRIM(pm.practice_id::text)
        WHERE TRIM(pm.clinician_id::text) = TRIM($1)
        ORDER BY pm.created_at ASC`,
      [clinicianId]
    );
    res.json({ mappings: rows });
  } catch (err) {
    next(err);
  }
};

export const createProjectMapping = async (req, res, next) => {
  try {
    const clinicianId = await assertClinicianAccess(req, req.params.id);
    const body = req.body || {};
    const { rows } = await query(
      `INSERT INTO project_mappings (
         clinician_id, project, practice_id, type, rate, rate_type, vat_percentage
       ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0))
       RETURNING *`,
      [
        clinicianId,
        body.project || null,
        toId(body.practice_id || body.practiceId) || null,
        body.type || null,
        body.rate != null ? Number(body.rate) : null,
        body.rate_type || body.rateType || null,
        body.vat_percentage ?? body.vatPercentage ?? 0,
      ]
    );
    res.status(201).json({ mapping: rows[0] });
  } catch (err) {
    next(err);
  }
};

export const deleteProjectMapping = async (req, res, next) => {
  try {
    const clinicianId = await assertClinicianAccess(req, req.params.id);
    const mappingId = toId(req.params.mappingId);
    if (!mappingId) return res.status(400).json({ message: "Invalid mapping id" });

    const { rowCount } = await query(
      `DELETE FROM project_mappings
        WHERE id = $1 AND TRIM(clinician_id::text) = TRIM($2)`,
      [mappingId, clinicianId]
    );
    if (!rowCount) return res.status(404).json({ message: "Mapping not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
