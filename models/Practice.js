import mongoose from "mongoose";

const PracticeContactSchema = new mongoose.Schema(
  {
    name:            { type: String, trim: true },
    role:            { type: String, trim: true },
    email:           { type: String, trim: true, lowercase: true },
    phone:           { type: String, trim: true },
    type:            {
      type: String,
      enum: ["general", "decision_maker", "finance", "gp_lead", "practice_manager"],
      default: "general",
    },
    isDecisionMaker: { type: Boolean, default: false },
  },
  { _id: true }
);

const DocumentSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true },
    url:        { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    category:   {
      type: String,
      enum: ["contract", "sop", "report", "compliance", "site_info", "other"],
      default: "other",
    },
  },
  { _id: true }
);

const SystemAccessSchema = new mongoose.Schema(
  {
    system:     { type: String, enum: ["EMIS", "SystmOne", "ICE", "AccuRx", "Docman", "Softphone", "VPN", "Other"] },
    code:       { type: String, default: "" },
    status:     { type: String, enum: ["not_requested", "requested", "pending", "granted", "view_only"], default: "not_requested" },
    requestedAt:{ type: Date },
    grantedAt:  { type: Date },
    notes:      { type: String, default: "" },
  },
  { _id: true }
);

// ── Rich per-document compliance tracking ─────────────────────────────────
const ComplianceDocMetaSchema = new mongoose.Schema(
  {
    fileName:        { type: String, default: "" },
    fileUrl:         { type: String, default: "" },
    mimeType:        { type: String, default: "" },
    fileSize:        { type: Number, default: 0 },
    status:          { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    uploadedAt:      { type: Date },
    expiryDate:      { type: Date },
    renewalDate:     { type: Date },
    verifiedAt:      { type: Date },
    verifiedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectionReason: { type: String, default: "" },
    notes:           { type: String, default: "" },
    version:         { type: Number, default: 1 },
    history: [
      {
        uploadedAt:  { type: Date },
        fileName:    { type: String },
        fileUrl:     { type: String },
        status:      { type: String },
        uploadedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      }
    ],
  },
  { _id: false }
);

const PracticeSchema = new mongoose.Schema(
  {
    // ── Core ─────────────────────────────────────────────────
    name:            { type: String, required: true, trim: true },
    pcn:             { type: mongoose.Schema.Types.ObjectId, ref: "PCN", required: true },
    odsCode:         { type: String, trim: true, default: "" },
    patientListSize: { type: Number, default: 0 },
    address:         { type: String, trim: true, default: "" },
    city:            { type: String, trim: true, default: "" },
    postcode:        { type: String, trim: true, default: "" },

    // ── Contacts ─────────────────────────────────────────────
    contacts: [PracticeContactSchema],

    // ── Linked Clinicians ─────────────────────────────────────
    linkedClinicians:    [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    restrictedClinicians:[{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ── System Access ─────────────────────────────────────────
    systemAccess:     [SystemAccessSchema],
    systemAccessNotes:{ type: String, default: "" },

    // ── Contract & Financial ──────────────────────────────────
    contractType:      { type: String, enum: ["ARRS", "EA", "Direct", "Mixed", ""], default: "" },
    fte:               { type: String, default: "" },
    contractSignedDate:{ type: Date },
    xeroCode:          { type: String, trim: true, default: "" },
    xeroCategory:      { type: String, enum: ["PCN", "GPX", "EAX", ""], default: "" },

    // ── Compliance boolean flags ───────────────────────────────
    cqcRating:                 { type: Boolean, default: false },
    indemnityInsurance:        { type: Boolean, default: false },
    healthSafety:              { type: Boolean, default: false },
    gdprPolicy:                { type: Boolean, default: false },
    informationGovernance:     { type: Boolean, default: false },
    ndaSigned:                 { type: Boolean, default: false },
    dsaSigned:                 { type: Boolean, default: false },
    mouReceived:               { type: Boolean, default: false },
    welcomePackSent:           { type: Boolean, default: false },
    mobilisationPlanSent:      { type: Boolean, default: false },
    confidentialityFormSigned: { type: Boolean, default: false },
    prescribingPoliciesShared: { type: Boolean, default: false },
    remoteAccessSetup:         { type: Boolean, default: false },
    templateInstalled:         { type: Boolean, default: false },
    reportsImported:           { type: Boolean, default: false },

    // ── NEW: Rich compliance document tracking ─────────────────
    complianceDocs: {
      cqcRating:                 { type: ComplianceDocMetaSchema, default: null },
      indemnityInsurance:        { type: ComplianceDocMetaSchema, default: null },
      healthSafety:              { type: ComplianceDocMetaSchema, default: null },
      gdprPolicy:                { type: ComplianceDocMetaSchema, default: null },
      informationGovernance:     { type: ComplianceDocMetaSchema, default: null },
      ndaSigned:                 { type: ComplianceDocMetaSchema, default: null },
      dsaSigned:                 { type: ComplianceDocMetaSchema, default: null },
      mouReceived:               { type: ComplianceDocMetaSchema, default: null },
      welcomePackSent:           { type: ComplianceDocMetaSchema, default: null },
      mobilisationPlanSent:      { type: ComplianceDocMetaSchema, default: null },
      confidentialityFormSigned: { type: ComplianceDocMetaSchema, default: null },
      prescribingPoliciesShared: { type: ComplianceDocMetaSchema, default: null },
      remoteAccessSetup:         { type: ComplianceDocMetaSchema, default: null },
      templateInstalled:         { type: ComplianceDocMetaSchema, default: null },
      reportsImported:           { type: ComplianceDocMetaSchema, default: null },
    },

    // ── Documents ─────────────────────────────────────────────
    documents: [DocumentSchema],

    // ── Rota ──────────────────────────────────────────────────
    rotaVisible: { type: Boolean, default: true },

    // ── Meta ──────────────────────────────────────────────────
    notes:    { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

PracticeSchema.index({ pcn: 1 });
PracticeSchema.index({ odsCode: 1 });
PracticeSchema.index({ name: "text" });

export default mongoose.model("Practice", PracticeSchema);