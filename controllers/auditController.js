/**
 * controllers/auditController.js
 *
 * FIXED:
 *  - mapRow correctly pulls userName/userRole from stored data
 *    (no async user-lookup needed — saved at write time now)
 *  - $idx parameter bug fixed (duplicate index in LIMIT/OFFSET)
 *  - Added dateFrom/dateTo filters
 */

import { query } from "../config/db.js";

const AUDIT_MODEL = "audit_log";

function mapRow(row) {
  if (!row) return null;
  const d = row.data || {};
  return {
    _id:        row.id,
    id:         row.id,
    action:     d.action      || "",
    resource:   d.resource    || "",
    resourceId: d.resourceId  || null,
    detail:     d.detail      || "",
    status:     d.status      || "success",
    userName:   d.userName    || "System",
    userRole:   d.userRole    || "system",
    userId:     d.userId      || d.user || null,
    ip:         d.ip          || "",
    userAgent:  d.userAgent   || "",
    before:     d.before      || null,
    after:      d.after       || null,
    createdAt:  d.createdAt   || row.created_at?.toISOString?.() || null,
  };
}

// GET /api/audit
export const getAuditLogs = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(200, parseInt(req.query.limit, 10) || 50);
    const offset = (page - 1) * limit;

    const conditions = [`model = $1`];
    const params     = [AUDIT_MODEL];
    let   idx        = 2;

    if (req.query.action) {
      conditions.push(`data->>'action' = $${idx++}`);
      params.push(req.query.action);
    }
    if (req.query.resource) {
      conditions.push(`data->>'resource' = $${idx++}`);
      params.push(req.query.resource);
    }
    if (req.query.status) {
      conditions.push(`data->>'status' = $${idx++}`);
      params.push(req.query.status);
    }
    if (req.query.user) {
      conditions.push(
        `(data->>'userId' = $${idx} OR data->>'user' = $${idx})`
      );
      params.push(req.query.user);
      idx++;
    }
    if (req.query.dateFrom) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(new Date(req.query.dateFrom));
    }
    if (req.query.dateTo) {
      conditions.push(`created_at <= $${idx++}`);
      params.push(new Date(req.query.dateTo));
    }

    const where     = conditions.join(" AND ");
    const limitIdx  = idx++;
    const offsetIdx = idx++;

    const [logsResult, countResult] = await Promise.all([
      query(
        `SELECT id, data, created_at FROM app_records
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) FROM app_records WHERE ${where}`, params),
    ]);

    const logs  = logsResult.rows.map(mapRow).filter(Boolean);
    const total = parseInt(countResult.rows[0].count, 10);

    return res.json({
      success: true,
      logs,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("getAuditLogs ERROR:", err.message);
    return res.status(500).json({ message: err.message });
  }
};