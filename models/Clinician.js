import { createModel } from "../lib/model.js";

/**
 * Clinician model — Module 3 (Clinician Management)
 *
 * Stored in `app_records` with model = "Clinician".
 * Mirrors the SQL spec at backend/sql/clinicians/001_create_clinicians.sql
 * but uses the project's JSONB record layer instead of a dedicated table.
 */

const Clinician = createModel({
  modelName: "Clinician",
  refs: {
    user:       { model: "User" },
    opsLead:    { model: "User" },
    supervisor: { model: "User" },
    createdBy:  { model: "User" },
  },
  defaults: {
    // ── Identity (linked User account is optional) ──────────
    user:           null,
    fullName:       "",
    clinicianType:  "Pharmacist",   // Pharmacist | Technician | IP
    gphcNumber:     "",
    smartCard:      "",

    // ── Contact ─────────────────────────────────────────────
    phone:          "",
    email:          "",
    addressLine1:   "",
    addressLine2:   "",
    city:           "",
    postcode:       "",

    emergencyContacts: [],   // [{ name, relationship, phone, email }]

    // ── Contract ────────────────────────────────────────────
    contractType:   "ARRS",  // ARRS | EA | Direct | Mixed
    noticePeriod:   "",      // e.g. "1 month"
    workingHours:   0,       // weekly contracted hours (number)
    startDate:      null,
    endDate:        null,

    // ── People links ────────────────────────────────────────
    opsLead:        null,
    supervisor:     null,

    // ── Skills / specialism ─────────────────────────────────
    specialisms:        [],    // ["Diabetes", "Asthma", ...]
    futurePotential:    "",
    scopeWorkstreams:   [],    // ["SMR", "EHCH", ...]
    shadowingAvailable: false,
    systemsInUse:       [],    // ["EMIS", "SystmOne", "ICE", "AccuRx", ...]

    // ── Onboarding (checklist + welcome pack metadata) ──────
    onboarding: {
      welcomePackSent:   false,
      welcomePackSentAt: null,
      welcomePackSentBy: null,
      mobilisationPlan:  false,
      systemsRequested:  false,
      smartcardOrdered:  false,
      contractSigned:    false,
      indemnityVerified: false,
      inductionBooked:   false,
      notes:             "",
    },

    // ── CPPE training tracker ───────────────────────────────
    cppeStatus: {
      enrolled:     false,
      exempt:       false,
      completed:    false,
      enrolledAt:   null,
      completedAt:  null,
      progressPct:  0,
      modules:      [],   // [{ name, status, completedAt }]
      notes:        "",
    },

    // ── Flags ───────────────────────────────────────────────
    isRestricted:   false,
    restrictReason: "",
    isActive:       true,

    // ── Misc ────────────────────────────────────────────────
    notes:      "",
    createdBy:  null,
  },
});

export default Clinician;
