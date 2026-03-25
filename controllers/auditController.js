import AuditLog from "../models/AuditLog.js";

// GET /api/audit  — paginated audit trail for super_admin
export const getAuditLogs = async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.action)   filter.action   = req.query.action;
    if (req.query.resource) filter.resource = req.query.resource;
    if (req.query.user)     filter.user     = req.query.user;
    if (req.query.status)   filter.status   = req.query.status;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name email role"),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      logs,
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};