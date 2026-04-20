import { createModel } from "../lib/model.js";

/**
 * Practice model
 *
 * UPDATED (Apr 2026):
 *   - Added: localDecisionMakers  (blueprint: "local decision makers")
 *   - Added: siteSpecificDocs     (blueprint: "site-specific documentation")
 *   - Added: contractDocuments    (document repository at practice level)
 *   - Added: reportingArchive     (monthly archive at practice level)
 *   - Added: rotaVisibility flag  (blueprint: "rota visibility")
 *   - Added: tags, priority       (ops wishlist)
 *   - Kept:  all existing fields unchanged
 */

const Practice = createModel({
  modelName: "Practice",
  refs: {
    pcn:                  { model: "PCN" },
    complianceGroup:      { model: "DocumentGroup" },
    linkedClinicians:     { model: "User" },
    restrictedClinicians: { model: "User" },
    createdBy:            { model: "User" },
  },
  defaults: {
    // ── Core identity ──────────────────────────────────────
    name:            "",
    pcn:             null,
    odsCode:         "",
    patientListSize: 0,

    // ── Location ───────────────────────────────────────────
    address:  "",
    city:     "",
    postcode: "",

    // ── Contacts ───────────────────────────────────────────
    // General contacts (type: decision_maker | finance | general)
    contacts: [],

    // NEW: Blueprint — "local decision makers" (dedicated field)
    localDecisionMakers: [], // [{ name, role, email, phone, isPrimary }]

    // ── Clinicians ─────────────────────────────────────────
    linkedClinicians:     [],
    restrictedClinicians: [],

    // ── System access ──────────────────────────────────────
    systemAccess:      [], // [{ system, code, status, grantedAt, notes }]
    systemAccessNotes: "",

    // ── Contract ───────────────────────────────────────────
    contractType:       "",   // ARRS | EA | Direct
    fte:                "",
    contractSignedDate: null,
    xeroCode:           "",
    xeroCategory:       "",

    // ── Compliance flags ───────────────────────────────────
    cqcRating:                false,
    indemnityInsurance:        false,
    healthSafety:              false,
    gdprPolicy:                false,
    informationGovernance:     false,
    ndaSigned:                 false,
    dsaSigned:                 false,
    mouReceived:               false,
    welcomePackSent:           false,
    mobilisationPlanSent:      false,
    confidentialityFormSigned: false,
    prescribingPoliciesShared: false,
    remoteAccessSetup:         false,
    templateInstalled:         false,
    reportsImported:           false,

    // ── Compliance documents (group-based) ─────────────────
    complianceDocs:  {},
    complianceGroup: null,
    groupDocuments:  [],

    // ── Documents ──────────────────────────────────────────
    documents: [],

    // NEW: site-specific documentation
    // Blueprint: "site-specific documentation" per practice
    siteSpecificDocs: [], // [{ name, fileUrl, fileName, uploadedAt, uploadedBy, notes, category }]

    // NEW: contract documents repository
    contractDocuments: [], // [{ name, fileUrl, fileName, uploadedAt, uploadedBy, notes }]

    // NEW: monthly reporting archive at practice level
    reportingArchive: [], // [{ month, year, reportUrl, fileName, uploadedAt, uploadedBy, notes }]

    // ── Rota ───────────────────────────────────────────────
    rotaVisible: true,     // existing field (was rotaVisible)

    // ── Ops metadata ───────────────────────────────────────
    tags:     [],           // NEW: ["urgent", "system-pending", etc.]
    priority: "normal",     // NEW: "low" | "normal" | "high"
    notes:    "",
    isActive: true,
    createdBy: null,
    viewedBy:  [],
  },
});

export default Practice;