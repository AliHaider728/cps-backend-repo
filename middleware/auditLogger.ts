/**
 * middleware/auditLogger.ts
 *
 * FIXED: Was writing to MongoDB (AuditLog.create) but auditController
 * reads from PostgreSQL app_records. Now both use the same store.
 */

import { Request } from "express";
import { query } from "../config/db.js";
import { v4 as uuidv4 } from "uuid";

const AUDIT_MODEL = "audit_log";

export interface CustomRequest extends Request {
  user?: {
    _id?: string;
    id?: string;
    name?: string;
    role?: string;
    [key: string]: any;
  };
}

export const getRequestIp = (req: CustomRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim())
    return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0)
    return String(forwarded[0]).trim();
  if (req.ip && req.ip !== "::1") return req.ip;
  return "unknown";
};

export interface AuditLogOptions {
  resourceId?: string | number | null;
  detail?: string;
  status?: string;
  before?: any;
  after?: any;
  ip?: string;
}

/**
 * logAudit — call anywhere in a controller to record an action.
 *
 * @param {CustomRequest} req
 * @param {string} action    — e.g. "LOGIN", "CREATE_CLIENT", "DELETE_USER"
 * @param {string} resource  — e.g. "User", "PCN", "Practice"
 * @param {AuditLogOptions} opts      — { resourceId, detail, before, after, status }
 */
export const logAudit = async (req: CustomRequest, action: string, resource: string, opts: AuditLogOptions = {}): Promise<void> => {
  try {
    const data = {
      action,
      resource,
      resourceId: opts.resourceId != null ? String(opts.resourceId) : null,
      detail:     opts.detail  ?? "",
      status:     opts.status  ?? "success",

      // Who
      userId:   req.user?._id  ?? req.user?.id ?? null,
      user:     req.user?._id  ?? req.user?.id ?? null,
      userName: req.user?.name ?? "System",
      userRole: req.user?.role ?? "system",

      // Diff
      before: opts.before ?? null,
      after:  opts.after  ?? null,

      // Request context
      ip:        opts.ip ?? getRequestIp(req),
      userAgent: req.headers?.["user-agent"] ?? "",

      createdAt: new Date().toISOString(),
    };

    await query(
      `INSERT INTO app_records (model, id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
      [AUDIT_MODEL, uuidv4(), JSON.stringify(data)]
    );
  } catch (err: any) {
    // Never throw — audit must not crash the main request
    console.error("[logAudit ERROR]", err.message);
  }
};
