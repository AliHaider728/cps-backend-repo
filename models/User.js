import { createModel, hashPasswordIfNeeded } from "../lib/model.js";

const User = createModel({
  modelName: "User",
  hiddenFields: ["password"],
  defaults: {
    name: "",
    email: "",
    password: "",
    role: "clinician",
    isActive: true,
    mustChangePassword: false,
    isAnonymised: false,
    createdBy: null,
    lastLogin: null,
  },
  beforeSave: async (document) => {
    if (document.email) {
      document.email = String(document.email).trim().toLowerCase();
    }
    await hashPasswordIfNeeded(document);
  },
  documentMethods: {
    async matchPassword(entered) {
      const bcrypt = await import("bcryptjs");
      return bcrypt.default.compare(entered, this.password || "");
    },
    async anonymise() {
      this.name = "Anonymised User";
      this.email = `anonymised-${this._id}@example.local`;
      this.password = "";
      this.isAnonymised = true;
      this.isActive = false;
      await this.save();
      return this;
    },
  },
});

export default User;
