import mongoose from "mongoose";

/**
 * PCN (Primary Care Network) Model
 * Top-level CLIENT record in CPS.
 */

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
    month: { type: String, default: "" }, // "Jan-2026" for monthly reports
  },
  { _id: true }
);

const EmailTemplateSchema = new mongoose.Schema(
  {
    name:    { type: String },
    subject: { type: String },
    body:    { type: String },
  },
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

    // ── Compliance flags ───────────────────────────────────
    ndaSigned:       { type: Boolean, default: false },
    dsaSigned:       { type: Boolean, default: false },
    mouReceived:     { type: Boolean, default: false },
    welcomePackSent: { type: Boolean, default: false },

    // ── Meta ───────────────────────────────────────────────
    notes:    { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual: practices count
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