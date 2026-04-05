import mongoose from "mongoose";

const DocumentGroupSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    displayOrder: { type: Number, default: 0 },
    active:       { type: Boolean, default: true },
    documents:    [{ type: mongoose.Schema.Types.ObjectId, ref: "ComplianceDocument" }],
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

DocumentGroupSchema.index({ name: "text" });
DocumentGroupSchema.index({ active: 1, displayOrder: 1 });

export default mongoose.model("DocumentGroup", DocumentGroupSchema);