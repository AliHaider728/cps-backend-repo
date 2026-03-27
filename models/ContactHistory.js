import mongoose from "mongoose";

const ContactHistorySchema = new mongoose.Schema({
  // Which entity this log belongs to
  entityType: { type: String, enum: ["ICB", "PCN", "Practice"], required: true },
  entityId:   { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "entityType" },

  type: {
    type: String,
    enum: ["email", "call", "meeting", "contract", "complaint", "system_access", "note"],
    required: true,
  },

  subject:  { type: String, required: true, trim: true },
  notes:    { type: String, default: "" },
  date:     { type: Date, required: true },
  starred:  { type: Boolean, default: false },

  // For email tracking
  emailTracking: {
    sent:     { type: Boolean, default: false },
    opened:   { type: Boolean, default: false },
    openedAt: { type: Date,    default: null },
    trackingId:{ type: String, default: null },   // unique token per email
  },

  // Mass email meta
  isMassEmail:  { type: Boolean, default: false },
  recipients:   [{ email: String, name: String, opened: Boolean, openedAt: Date }],

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

ContactHistorySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
ContactHistorySchema.index({ starred: 1 });
ContactHistorySchema.index({ "emailTracking.trackingId": 1 });

export default mongoose.model("ContactHistory", ContactHistorySchema);