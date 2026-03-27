import mongoose from "mongoose";

const PracticeSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  pcn:     { type: mongoose.Schema.Types.ObjectId, ref: "PCN", required: true },
  address: { type: String, trim: true, default: "" },
  odsCode: { type: String, trim: true, default: "" },      // NHS ODS code
  contacts: [{
    name:  String,
    role:  String,
    email: { type: String, lowercase: true },
    phone: String,
    isDecisionMaker: { type: Boolean, default: false },
  }],
  linkedClinicians:    [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  systemAccessNotes:   { type: String, default: "" },
  isActive:            { type: Boolean, default: true },
  restrictedClinicians:[{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdBy:           { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export default mongoose.model("Practice", PracticeSchema);