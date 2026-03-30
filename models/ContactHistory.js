import mongoose from "mongoose";

/**
 * ContactHistory Model
 * Tracks all interactions (calls, emails, meetings, notes) with PCNs and Practices.
 */

const EmailTrackingSchema = new mongoose.Schema(
  {
    trackingId:  { type: String },   // NOTE: index defined below via schema.index() only — no index:true here
    sentAt:      { type: Date },
    openedAt:    { type: Date },
    clickedAt:   { type: Date },
    status:      { type: String, enum: ["sent", "delivered", "opened", "clicked", "failed"], default: "sent" },
  },
  { _id: false }
);

const ContactHistorySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["PCN", "Practice", "Federation", "ICB"],
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "entityType",
    },

    type: {
      type: String,
      enum: ["call", "email", "meeting", "note", "complaint", "document", "system_access"],
      required: true,
    },

    subject:  { type: String, trim: true, default: "" },
    notes:    { type: String, default: "" },
    date:     { type: Date, default: Date.now },
    time:     { type: String, default: "" },   // "09:30"
    starred:  { type: Boolean, default: false },

    // ── Email tracking (optional, for email type) ──────────
    emailTracking: EmailTrackingSchema,

    // ── Linked resources ───────────────────────────────────
    attachments: [
      {
        name: { type: String },
        url:  { type: String },
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────
ContactHistorySchema.index({ entityType: 1, entityId: 1 });
ContactHistorySchema.index({ createdAt: -1 });
ContactHistorySchema.index({ starred: 1 });
ContactHistorySchema.index({ "emailTracking.trackingId": 1 }); // single definition only — no index:true above

export default mongoose.model("ContactHistory", ContactHistorySchema);