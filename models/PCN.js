import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema({
  name:  { type: String, trim: true },
  role:  { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  type:  { type: String, enum: ["general", "decision_maker", "finance"], default: "general" },
}, { _id: true });

const PCNSchema = new mongoose.Schema({
  name:               { type: String, required: true, trim: true },
  icb:                { type: mongoose.Schema.Types.ObjectId, ref: "ICB", required: true },
  federation:         { type: String, trim: true, default: "" },
  contacts:           [ContactSchema],
  annualSpend:        { type: Number, default: 0 },
  notes:              { type: String, default: "" },
  isActive:           { type: Boolean, default: true },
  emailTemplates:     [{ name: String, subject: String, body: String }],
  restrictedClinicians: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export default mongoose.model("PCN", PCNSchema);