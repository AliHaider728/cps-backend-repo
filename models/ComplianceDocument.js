import mongoose from "mongoose";

const ComplianceDocumentSchema = new mongoose.Schema(
  {
    name:               { type: String, required: true, trim: true },
    displayOrder:       { type: Number, default: 0 },
    mandatory:          { type: Boolean, default: true },
    expirable:          { type: Boolean, default: false },
    active:             { type: Boolean, default: true },
    defaultExpiryDays:  { type: Number, default: 365 },
    defaultReminderDays:{ type: Number, default: 28 },
    createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ComplianceDocumentSchema.index({ name: "text" });
ComplianceDocumentSchema.index({ active: 1, displayOrder: 1 });

export default mongoose.model("ComplianceDocument", ComplianceDocumentSchema);