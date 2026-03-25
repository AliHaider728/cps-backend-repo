import AuditLog from "../models/AuditLog.js";

/**
 * logAudit — call this anywhere in a controller to record an action.
 *
 * @param {object} req      - Express request (for user + IP)
 * @param {string} action   - e.g. "LOGIN", "CREATE_USER", "DELETE_USER"
 * @param {string} resource - e.g. "User", "Clinician"
 * @param {object} opts     - { resourceId, detail, before, after, status }
 */
export const logAudit = async (req, action, resource, opts = {}) => {
  try {
    await AuditLog.create({
      user:       req.user?._id   ?? null,
      userName:   req.user?.name  ?? "System",
      userRole:   req.user?.role  ?? "system",
      action,
      resource,
      resourceId: opts.resourceId ?? null,
      detail:     opts.detail     ?? "",
      before:     opts.before     ?? undefined,
      after:      opts.after      ?? undefined,
      ip:         req.ip ?? req.headers["x-forwarded-for"] ?? "unknown",
      userAgent:  req.headers["user-agent"] ?? "",
      status:     opts.status     ?? "success",
    });
  } catch (err) {
    // Audit failure should never crash the main request
    console.error("Audit log error:", err.message);
  }
};