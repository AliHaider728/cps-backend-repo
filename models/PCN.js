import { createModel } from "../lib/model.js";

/**
 * PCN model
 *
 * UPDATED (Apr 2026):
 *   - Added: reportingArchive   (blueprint: "monthly reporting archive")
 *   - Added: decisionMakers     (blueprint: "decision makers" — dedicated array)
 *   - Added: financeContacts    (blueprint: "finance contacts" — dedicated array)
 *   - Added: clientFacingData   (blueprint: "client-facing front screen")
 *   - Added: contractDocuments  (blueprint: "document repository")
 *   - Added: tags, priority     (ops wishlist — filtering & sorting)
 *   - Kept:  all existing fields unchanged
 */

const PCN = createModel({
  modelName: "PCN",
  refs: {
    icb:                  { model: "ICB" },
    federation:           { model: "Federation" },
    complianceGroup:      { model: "DocumentGroup" },
    complianceGroups:     { model: "DocumentGroup" },
    activeClinicians:     { model: "User" },
    restrictedClinicians: { model: "User" },
    createdBy:            { model: "User" },
  },
  defaults: {
    // ── Core identity ──────────────────────────────────────
    name:           "",
    icb:            null,
    federation:     null,
    federationName: "",

    // ── Contacts ───────────────────────────────────────────
    // General contacts array (type: decision_maker | finance | general | operations)
    contacts: [],

    // Blueprint: dedicated decision maker + finance contact fields
    decisionMakers: [],    // NEW: [{ name, role, email, phone, isPrimary }]
    financeContacts: [],   // NEW: [{ name, role, email, phone }]

    // ── Contract ───────────────────────────────────────────
    annualSpend:          0,
    contractType:         "",   // ARRS | EA | Direct
    contractStartDate:    null,
    contractRenewalDate:  null,
    contractExpiryDate:   null,
    xeroCode:             "",
    xeroCategory:         "",

    // ── Clinicians ─────────────────────────────────────────
    activeClinicians:     [],
    restrictedClinicians: [],

    // ── Documents ──────────────────────────────────────────
    documents: [],

    // NEW: document repository — stores PCN-level docs (MOUs, contracts, etc.)
    contractDocuments: [], // [{ name, fileUrl, fileName, uploadedAt, uploadedBy, notes }]

    // NEW: monthly reporting archive
    // Blueprint: "monthly reporting archive" per PCN record
    reportingArchive: [],  // [{ month, year, reportUrl, fileName, uploadedAt, uploadedBy, notes, starred }]

    // ── Email ──────────────────────────────────────────────
    emailTemplates: [],

    // ── Meetings ───────────────────────────────────────────
    monthlyMeetings: [],   // [{ month, date, type, attendees, notes, status }]

    // NEW: client-facing front screen data
    // Blueprint: "Client-facing front screen showing monthly meetings and clinician meetings"
    clientFacingData: {
      showMonthlyMeetings:   true,
      showClinicianMeetings: true,
      publicNotes:           "",
      lastUpdated:           null,
    },

    // ── Required systems ───────────────────────────────────
    requiredSystems: {
      emis:      false,
      systmOne:  false,
      ice:       false,
      accurx:    false,
      docman:    false,
      softphone: false,
      vpn:       false,
      other:     "",
    },

    // ── Compliance flags ───────────────────────────────────
    ndaSigned:      false,
    dsaSigned:      false,
    mouReceived:    false,
    gdprAgreement:  false,
    welcomePackSent: false,
    govChecklist:   false,
    insuranceCert:  false,

    // ── Compliance documents (group-based) ─────────────────
    complianceDocs:   {},
    complianceGroup:  null,
    complianceGroups: [],
    groupDocuments:   [],

    // ── Ops metadata ───────────────────────────────────────
    tags:     [],           // NEW: ["urgent", "renewal-due", etc.]
    priority: "normal",     // NEW: "low" | "normal" | "high"
    notes:    "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export default PCN;