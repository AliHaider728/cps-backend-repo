import { createModel } from "../lib/model.js";

/**
 * Federation model
 *
 * UPDATED (Apr 2026):
 *   - Added: contacts     (federation-level contacts)
 *   - Added: website      (reference info)
 *   - Added: address      (physical address)
 *   - Kept:  all existing fields unchanged
 */

const Federation = createModel({
  modelName: "Federation",
  refs: {
    icb: { model: "ICB" },
  },
  defaults: {
    // ── Core identity ──────────────────────────────────────
    name: "",
    type: "",            // "federation" | "INT" (Integrated Neighbourhood Team)
    icb:  null,

    // ── Contacts ───────────────────────────────────────────
    contacts: [],        // NEW: [{ name, role, email, phone, type }]
    website:  "",        // NEW
    address:  "",        // NEW

    // ── Meta ───────────────────────────────────────────────
    notes:    "",
    isActive: true,
    createdBy: null,
    viewedBy:  [],
  },
});

export default Federation;