import { createModel, hashPasswordIfNeeded } from "../lib/model.js";

/**
 * User model
 *
 * UPDATED (Apr 2026):
 *   - Added: phone            (clinician list view — blueprint section 03)
 *   - Added: profilePhoto     (clinician profile page)
 *   - Added: department       (SLT | Clinician | Finance | Training | Workforce)
 *   - Added: jobTitle         (display on profile)
 *   - Added: emergencyContact (blueprint: "emergency contacts" on clinician profile)
 *   - Added: opsLead          (blueprint: "assigned Ops Lead" per clinician)
 *   - Added: supervisor       (blueprint: "Clinical Supervisor — me or Sonia")
 *   - Added: startDate        (onboarding — when clinician joined)
 *   - Added: leaveDate        (GDPR anonymisation trigger after 7 years)
 *   - Kept:  all existing fields unchanged
 */

const User = createModel({
  modelName: "User",
  hiddenFields: ["password"],
  defaults: {
    // ── Core auth ──────────────────────────────────────────
    name:               "",
    email:              "",
    password:           "",
    role:               "clinician",  // super_admin | director | ops_manager | finance | training | workforce | clinician
    isActive:           true,
    mustChangePassword: false,
    isAnonymised:       false,
    lastLogin:          null,

    // ── Contact info ───────────────────────────────────────
    phone:        "",   // NEW: required for clinician list view (blueprint section 03)
    profilePhoto: "",   // NEW: URL to profile photo

    // ── Role / department ──────────────────────────────────
    department: "",     // NEW: "SLT" | "Clinician" | "Finance" | "Training" | "Workforce"
    jobTitle:   "",     // NEW: display title e.g. "Clinical Pharmacist", "Independent Prescriber"

    // ── Emergency contact ──────────────────────────────────
    // Blueprint section 03: "emergency contacts" on clinician profile
    emergencyContact: {
      name:         "",
      relationship: "",
      phone:        "",
      email:        "",
    },

    // ── Assignment ─────────────────────────────────────────
    // Blueprint section 03: "assigned Ops Lead and Supervisor" per clinician
    opsLead:    null,   // NEW: ref to User (ops_manager role) — NOTE: store as ID string
    supervisor: null,   // NEW: ref to User (training role — Stacey or Sonia)

    // ── Employment dates ───────────────────────────────────
    startDate: null,    // NEW: onboarding start date
    leaveDate: null,    // NEW: when clinician left — triggers GDPR anonymisation after 7 years

    // ── Meta ───────────────────────────────────────────────
    createdBy: null,
  },

  beforeSave: async (document) => {
    if (document.email) {
      document.email = String(document.email).trim().toLowerCase();
    }
    await hashPasswordIfNeeded(document);
  },

  documentMethods: {
    async matchPassword(entered) {
      const bcrypt = await import("bcryptjs");
      return bcrypt.default.compare(entered, this.password || "");
    },
    async anonymise() {
      this.name             = "Anonymised User";
      this.email            = `anonymised-${this._id}@example.local`;
      this.password         = "";
      this.phone            = "";
      this.profilePhoto     = "";
      this.emergencyContact = { name: "", relationship: "", phone: "", email: "" };
      this.isAnonymised     = true;
      this.isActive         = false;
      await this.save();
      return this;
    },
  },
});

export default User;