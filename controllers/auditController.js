/**
 * auditController.js
 * CONVERTED TO POSTGRESQL (Apr 2026)
 *
 * Data stored in app_records: model = "audit_log"
 */

import { query } from "../config/db.js";

const AUDIT_MODEL = "audit_log";
const USER_MODEL  = "user";

function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || null,
  };
}
function mapRows(rows) { return (rows || []).map(mapRow).filter(Boolean); }

async function findUserById(id) {
  if (!id) return null;
  const r = await query(
    `SELECT id, data FROM app_records WHERE model = $1 AND id = $2 LIMIT 1`,
    [USER_MODEL, id]
  );
  if (!r.rows[0]) return null;
  const u = { _id: r.rows[0].id, ...r.rows[0].data };
  return { _id: u._id, name: u.name, email: u.email, role: u.role };
}

// GET /api/audit — paginated audit trail for super_admin
export const getAuditLogs = async (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const conditions = [`model = $1`];
    const params     = [AUDIT_MODEL];
    let   idx        = 2;

    if (req.query.action)   { conditions.push(`data->>'action' = $${idx++}`);   params.push(req.query.action); }
    if (req.query.resource) { conditions.push(`data->>'resource' = $${idx++}`); params.push(req.query.resource); }
    if (req.query.status)   { conditions.push(`data->>'status' = $${idx++}`);   params.push(req.query.status); }
    if (req.query.user)     { conditions.push(`data->>'userId' = $${idx++}`);   params.push(req.query.user); }

    const where = conditions.join(" AND ");

    const [logsResult, countResult] = await Promise.all([
      query(
        `SELECT id, data, created_at FROM app_records WHERE ${where}
         ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) FROM app_records WHERE ${where}`, params),
    ]);

    const logs  = mapRows(logsResult.rows);
    const total = parseInt(countResult.rows[0].count, 10);

    // Populate user field
    const populated = await Promise.all(logs.map(async log => {
      const userId = log.userId || log.user;
      if (userId && typeof userId === "string") {
        const u = await findUserById(userId);
        return { ...log, user: u || { _id: userId } };
      }
      return log;
    }));

    res.json({
      success: true,
      logs: populated,
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("getAuditLogs ERROR:", err.message);
    res.status(500).json({ message: err.message });
  }
};