import { createModel } from "../lib/model.js";

/**
 * ComplianceDocument model
 *
 * UPDATED (Apr 2026):
 *   - Added: defaultReminderDays  (was in seed but missing from model)
 *   - Added: notes                (admin notes per document type)
 *   - Added: visibleToClinicianl  (clinician self-upload — blueprint section 06)
 *   - Added: clinicianCanUpload   (blueprint: "clinicians upload their own certs")
 *   - Kept:  all existing fields unchanged
 */

const ComplianceDocument = createModel({
  modelName: "ComplianceDocument",
  defaults: {
    // ── Core ───────────────────────────────────────────────
    name:        "",
    description: "",

    // ── Categorisation ─────────────────────────────────────
    category:     "other",       // "identity" | "dbs" | "insurance" | "training" | "clinical" | "other"
    applicableTo: ["Clinician"], // ["Clinician"] | ["PCN"] | ["Practice"] | ["All"]
    displayOrder: 0,

    // ── Rules ──────────────────────────────────────────────
    mandatory:        true,
    expirable:        false,
    active:           true,

    // ── Expiry & reminders ─────────────────────────────────
    defaultExpiryDays:  365,
    defaultReminderDays: 28,     // NEW: was in seed but missing from model
    reminderDays:       [30, 14, 7, 0],

    // ── Booking rules ──────────────────────────────────────
    autoSendOnBooking: false,    // auto-send to clinician on booking
    preStartRequired:  false,    // must be complete before first shift

    // ── Clinician self-upload ──────────────────────────────
    // Blueprint section 06: "clinicians upload their own certificates directly"
    clinicianCanUpload:   true,  // NEW: can clinician upload this themselves?
    visibleToClinician:   true,  // NEW: can clinician see this document's status?

    // ── Template ───────────────────────────────────────────
    templateFileUrl:  "",
    templateFileName: "",

    // ── Admin notes ────────────────────────────────────────
    notes: "",                   // NEW: internal admin notes about this doc type

    // ── Meta ───────────────────────────────────────────────
    createdBy: null,
    updatedBy: null,
  },
});

export default ComplianceDocument;