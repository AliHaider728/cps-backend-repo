/**
 * DocumentGroup.js
 * A named collection of ComplianceDocuments
 * e.g. "ARRS Clinician Pack", "PCN Onboarding", "Practice Setup"
 *
 * CPS: Groups can be assigned to Clinicians, PCNs, or Practices
 *      and control what documents are required for each entity type.
 */

import mongoose from "mongoose";

const DocumentGroupSchema = new mongoose.Schema(
  {
    // ── Core fields ───────────────────────────────────────
    name:         { type: String, required: true, trim: true },
    description:  { type: String, trim: true, default: "" },
    displayOrder: { type: Number, default: 0 },
    active:       { type: Boolean, default: true },

    // ── Which entity types this group applies to ──────────
    // CPS: Some groups are for Clinicians, some for PCN/Practice
    applicableEntityTypes: {
      type: [String],
      enum: ["Clinician", "PCN", "Practice", "ICB"],
      default: ["Clinician"],
    },

    // ── Documents in this group ───────────────────────────
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: "ComplianceDocument" }],

    // ── Pre-start checklist flag ──────────────────────────
    // CPS: Some groups are specifically pre-start checklists
    isPreStartChecklist: { type: Boolean, default: false },

    // ── Auto-assign on booking ────────────────────────────
    // CPS: Auto-send required documents to clinician on booking to contract
    autoAssignOnBooking: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

DocumentGroupSchema.index({ name: "text", description: "text" });
DocumentGroupSchema.index({ active: 1, displayOrder: 1 });
DocumentGroupSchema.index({ applicableEntityTypes: 1 });
DocumentGroupSchema.index({ autoAssignOnBooking: 1 });

export default mongoose.model("DocumentGroup", DocumentGroupSchema);