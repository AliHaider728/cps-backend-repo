import { createModel } from "../lib/model.js";

/**
 * ICB model
 *
 * UPDATED (Apr 2026):
 *   - Added: contacts        (ICB-level contacts for hierarchy view)
 *   - Added: website         (reference info)
 *   - Added: contractCount   (computed/cached — how many active PCNs)
 *   - Kept:  all existing fields unchanged
 */

const ICB = createModel({
  modelName: "ICB",
  defaults: {
    // ── Core identity ──────────────────────────────────────
    name:   "",
    code:   "",          // e.g. "QOP", "QE1"
    region: "",          // e.g. "North West"

    // ── Contacts ───────────────────────────────────────────
    contacts: [],        // NEW: [{ name, role, email, phone, type }]
    website:  "",        // NEW: NHS ICB website URL

    // ── Meta ───────────────────────────────────────────────
    notes:    "",
    isActive: true,
    createdBy: null,
    viewedBy:  [],
  },
});

export default ICB;