import mongoose from "mongoose";

const ICBSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true, unique: true },
  region:  { type: String, trim: true, default: "" },
  notes:   { type: String, default: "" },
  isActive:{ type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export default mongoose.model("ICB", ICBSchema);