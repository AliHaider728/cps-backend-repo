import { createModel } from "../lib/model.js";

/**
 * AuditLog model
 *
 * UPDATED (Apr 2026):
 *   - Added: sessionId     (group related actions per login session)
 *   - Added: duration      (how long the action took in ms)
 *   - Added: metadata      (flexible extra data per action type)
 *   - Kept:  all existing fields unchanged
 */

const AuditLog = createModel({
  modelName: "AuditLog",
  refs: {
    user: { model: "User" },
  },
  defaults: {
    // ── Who ────────────────────────────────────────────────
    user:     null,
    userName: "System",
    userRole: "system",

    // ── What ───────────────────────────────────────────────
    action:     "",      // "CREATE_CLIENT" | "UPDATE_PCN" | "DELETE_PRACTICE" etc.
    resource:   "",      // "PCN" | "Practice" | "User" | "Compliance" etc.
    resourceId: null,
    detail:     "",      // human-readable description

    // ── Diff ───────────────────────────────────────────────
    before: null,        // snapshot before change
    after:  null,        // snapshot after change

    // ── Request context ────────────────────────────────────
    ip:        "",
    userAgent: "",

    // ── Result ─────────────────────────────────────────────
    status: "success",   // "success" | "failure" | "warning"

    // ── Extra ──────────────────────────────────────────────
    sessionId: "",       // NEW: group actions per login session
    duration:  null,     // NEW: ms taken for the operation
    metadata:  null,     // NEW: flexible extra data { module, subAction, etc. }
  },
});

export default AuditLog;