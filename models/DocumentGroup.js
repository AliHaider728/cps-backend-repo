import { createModel } from "../lib/model.js";

/**
 * DocumentGroup model
 *
 * UPDATED (Apr 2026):
 *   - Added: applicableContractTypes  (ARRS | EA | Direct — different groups per contract)
 *   - Added: notes                    (admin notes per group)
 *   - Added: colour                   (UI colour coding for group badges)
 *   - Kept:  all existing fields unchanged
 */

const DocumentGroup = createModel({
  modelName: "DocumentGroup",
  refs: {
    documents: { model: "ComplianceDocument" },
    createdBy: { model: "User" },
    updatedBy: { model: "User" },
  },
  defaults: {
    // ── Core ───────────────────────────────────────────────
    name:        "",
    description: "",
    displayOrder: 0,
    active:       true,

    // ── Applicability ──────────────────────────────────────
    applicableEntityTypes:    ["Clinician"], // "Clinician" | "PCN" | "Practice"

    // NEW: which contract types this group applies to
    applicableContractTypes:  [],           // [] = all | ["ARRS"] | ["EA"] | ["Direct"]

    // ── Documents ──────────────────────────────────────────
    documents: [],           // refs to ComplianceDocument

    // ── Behaviour flags ────────────────────────────────────
    isPreStartChecklist: false,   // must be complete before first shift
    autoAssignOnBooking: false,   // auto-assign this group when clinician booked

    // ── UI ─────────────────────────────────────────────────
    colour: "",              // NEW: e.g. "blue" | "green" | "amber" for badge colour in UI

    // ── Admin notes ────────────────────────────────────────
    notes: "",               // NEW: internal notes about this group

    // ── Meta ───────────────────────────────────────────────
    createdBy: null,
    updatedBy: null,
  },
});

export default DocumentGroup;