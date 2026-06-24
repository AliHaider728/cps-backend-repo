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
 *
 * UPDATED (Jun 2026):
 *   - Removed: annualSpend
 *   - Added:   hourlyRate, contractStartDate
 *
 * UPDATED (Jun 2026 — Rate History):
 *   - Added: hourlyRateHistory  (array of rate change log entries)
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
    contacts: [],
    decisionMakers: [],
    financeContacts: [],

    // ── Contract ───────────────────────────────────────────
    hourlyRate:           null,
    contractType:         "",
    contractStartDate:    null,
    contractRenewalDate:  null,
    contractExpiryDate:   null,
    xeroCode:             "",
    xeroCategory:         "",

    // ── Hourly Rate History ────────────────────────────────
    // Tracks every rate change: [{ rate, effectiveDate, changedBy (User ref), notes }]
    hourlyRateHistory: [],

    // ── Clinicians ─────────────────────────────────────────
    activeClinicians:     [],
    restrictedClinicians: [],

    // ── Documents ──────────────────────────────────────────
    documents: [],
    contractDocuments: [],

    // ── Reporting archive ──────────────────────────────────
    reportingArchive: [],

    // ── Email ──────────────────────────────────────────────
    emailTemplates: [],

    // ── Meetings ───────────────────────────────────────────
    monthlyMeetings: [],

    // ── Client-facing front screen ─────────────────────────
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
    tags:     [],
    priority: "normal",
    notes:    "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export default PCN;