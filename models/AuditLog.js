import mongoose from "mongoose";


const AuditLogSchema = new mongoose.Schema(
  {
    user:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName:   { type: String, default: "System" },
    userRole:   { type: String, default: "system" },
    action:     { type: String, required: true },        // e.g. LOGIN, CREATE_USER, UPDATE_USER
    resource:   { type: String, required: true },        // e.g. User, Clinician, Contract
    resourceId: { type: String, default: null },
    detail:     { type: String, default: "" },           // human-readable summary
    before:     { type: mongoose.Schema.Types.Mixed },   // snapshot before change
    after:      { type: mongoose.Schema.Types.Mixed },   // snapshot after change
    ip:         { type: String, default: "unknown" },
    userAgent:  { type: String, default: "" },
    status:     { type: String, enum: ["success", "fail"], default: "success" },
  },
  { timestamps: true }
);

// Index for fast dashboard queries
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ user: 1 });
AuditLogSchema.index({ action: 1 });

export default mongoose.model("AuditLog", AuditLogSchema);