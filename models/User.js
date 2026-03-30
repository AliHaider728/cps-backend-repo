import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const UserSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true, minlength: 6, select: false },
    role: {
      type: String,
      enum: ["super_admin", "director", "ops_manager", "finance", "training", "workforce", "clinician"],
      required: true,
    },
    isActive:           { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLogin:          { type: Date },
    createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── GDPR ──
    anonymisedAt: { type: Date,    default: null },
    isAnonymised: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// NOTE: No manual index needed — email has unique:true which creates index automatically

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

UserSchema.methods.anonymise = async function () {
  this.name          = "Anonymised User";
  this.email         = `anon_${this._id}@deleted.internal`;
  this.isActive      = false;
  this.isAnonymised  = true;
  this.anonymisedAt  = new Date();
  await this.save({ validateBeforeSave: false });
};

export default mongoose.model("User", UserSchema);