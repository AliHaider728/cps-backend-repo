import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema(
  {
    name:  { type: String, trim: true },
    role:  { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    type:  {
      type: String,
      enum: ["general", "decision_maker", "finance", "clinical_lead", "operations"],
      default: "general",
    },
    isPrimary: { type: Boolean, default: false },
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
      enum: ["contract", "sop", "report", "compliance", "other"],
      default: "other",
    },
    month: { type: String, default: "" },
  },
  { _id: true }
);

const EmailTemplateSchema = new mongoose.Schema(
  { name: String, subject: String, body: String },
  { _id: true }
);

const MonthlyMeetingSchema = new mongoose.Schema(
  {
    month:     { type: String },
    date:      { type: Date },
    type:      { type: String, enum: ["monthly_review", "clinician_meeting", "governance", "other"], default: "monthly_review" },
    attendees: [{ type: String }],
    notes:     { type: String, default: "" },
    status:    { type: String, enum: ["scheduled", "completed", "cancelled", "not_booked"], default: "scheduled" },
  },
  { _id: true }
);

// ── NEW: Per-document compliance metadata ──────────────────────────────────
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

const PCNSchema = new mongoose.Schema(
  {
    // ── Core identity ──────────────────────────────────────
    name:           { type: String, required: true, trim: true },
    icb:            { type: mongoose.Schema.Types.ObjectId, ref: "ICB", required: true },
    federation:     { type: mongoose.Schema.Types.ObjectId, ref: "Federation" },
    federationName: { type: String, trim: true, default: "" },

    // ── Contacts ──────────────────────────────────────────
    contacts: [ContactSchema],

    // ── Contract & Financial ───────────────────────────────
    annualSpend:        { type: Number, default: 0 },
    contractType:       { type: String, enum: ["ARRS", "EA", "Direct", "Mixed", ""], default: "" },
    contractStartDate:  { type: Date },
    contractRenewalDate:{ type: Date },
    contractExpiryDate: { type: Date },
    xeroCode:           { type: String, trim: true, default: "" },
    xeroCategory:       { type: String, enum: ["PCN", "GPX", "EAX", ""], default: "" },

    // ── Clinicians ─────────────────────────────────────────
    activeClinicians:    [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    restrictedClinicians:[{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ── Documents ──────────────────────────────────────────
    documents:      [DocumentSchema],
    emailTemplates: [EmailTemplateSchema],

    // ── Monthly meetings ───────────────────────────────────
    monthlyMeetings: [MonthlyMeetingSchema],

    // ── Required systems ───────────────────────────────────
    requiredSystems: {
      emis:     { type: Boolean, default: false },
      systmOne: { type: Boolean, default: false },
      ice:      { type: Boolean, default: false },
      accurx:   { type: Boolean, default: false },
      docman:   { type: Boolean, default: false },
      softphone:{ type: Boolean, default: false },
      vpn:      { type: Boolean, default: false },
      other:    { type: String, default: "" },
    },

    // ── Compliance boolean flags (legacy / checklist) ──────
    ndaSigned:       { type: Boolean, default: false },
    dsaSigned:       { type: Boolean, default: false },
    mouReceived:     { type: Boolean, default: false },
    gdprAgreement:   { type: Boolean, default: false },
    welcomePackSent: { type: Boolean, default: false },
    govChecklist:    { type: Boolean, default: false },
    insuranceCert:   { type: Boolean, default: false },

    // ── NEW: Rich compliance document tracking ─────────────
    complianceDocs: {
      ndaSigned:       { type: ComplianceDocMetaSchema, default: null },
      dsaSigned:       { type: ComplianceDocMetaSchema, default: null },
      mouReceived:     { type: ComplianceDocMetaSchema, default: null },
      gdprAgreement:   { type: ComplianceDocMetaSchema, default: null },
      welcomePackSent: { type: ComplianceDocMetaSchema, default: null },
      insuranceCert:   { type: ComplianceDocMetaSchema, default: null },
      govChecklist:    { type: ComplianceDocMetaSchema, default: null },
    },

    // ── Meta ───────────────────────────────────────────────
    notes:    { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

PCNSchema.virtual("practices", {
  ref:         "Practice",
  localField:  "_id",
  foreignField: "pcn",
  options:     { match: { isActive: true } },
});

PCNSchema.index({ icb: 1 });
PCNSchema.index({ federation: 1 });
PCNSchema.index({ name: "text" });

export default mongoose.model("PCN", PCNSchema);