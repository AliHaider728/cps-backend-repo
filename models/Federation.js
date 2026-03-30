import mongoose from "mongoose";

/**
 * Federation / Integrated Neighbourhood Team (INT) Model
 * Sits between ICB and PCNs in the hierarchy.
 * A PCN must belong to a Federation which belongs to an ICB.
 */
const FederationSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    icb:      { type: mongoose.Schema.Types.ObjectId, ref: "ICB", required: true },
    type:     { type: String, enum: ["federation", "INT", "other"], default: "federation" },
    notes:    { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

FederationSchema.index({ icb: 1 });

export default mongoose.model("Federation", FederationSchema);