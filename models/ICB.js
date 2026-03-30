import mongoose from "mongoose";

/**
 * ICB Model
 * Top-level NHS governance body (42/43 nationally)
 * Each ICB can have multiple Federations/INTs and PCNs underneath
 */
const ICBSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true, unique: true }, // unique:true already creates index
    region:   { type: String, trim: true, default: "" },
    code:     { type: String, trim: true, default: "" },   // e.g. QOP, QVV
    notes:    { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// REMOVED: ICBSchema.index({ name: 1 }) — duplicate of unique:true index above

export default mongoose.model("ICB", ICBSchema);