/**
 * models/ContactHistory.js
 *
 * ROOT CAUSE FIX (Apr 2026):
 *   BEFORE: Used createModel from lib/model.js → stored as model = "ContactHistory"
 *   AFTER:  Uses createRepository from lib/recordModel.js → stored as model = "client"
 *           with fixedData: { recordType: "ContactHistory" }
 *
 * This aligns ContactHistory with ALL other models (PCN, Practice, ICB, Federation, User)
 * which all use createRepository / tableModel = "client".
 *
 * WHY THIS FIXES THE BUG:
 *   The old createModel system stored records under model = "ContactHistory".
 *   lib/recordModel.js also defines ContactHistory but under model = "client".
 *   These are two different DB buckets → queries returned empty results if data
 *   was created via one system and read via the other.
 *
 * MIGRATION REQUIRED:
 *   Run scripts/migrate-contact-history.js once after deploying this fix
 *   to move existing records from model="ContactHistory" to model="client".
 */

import { createRepository } from "../lib/recordModel.js";

const ContactHistory = createRepository({
  modelName: "ContactHistory",
  tableModel: "client",          // ← SAME table as all other entities
  fixedData: {
    recordType: "ContactHistory", // ← discriminator within the "client" table
  },
  refs: {
    createdBy: { model: "User" },
    readBy:    { model: "User" },
  },
  defaults: {
    // ── Entity reference ─────────────────────────────────────
    entityType: "",          // "PCN" | "Practice" | "Federation" | "ICB"
    entityId:   "",          // UUID string — matches how other models store refs

    // ── Log type ─────────────────────────────────────────────
    // note | email | call | meeting | complaint | document
    // system_access | contract | report | other
    type:    "note",
    subject: "",

    // ── Content ──────────────────────────────────────────────
    notes:   "",             // primary content field used by controller
    detail:  "",             // legacy alias — kept for backwards compat

    // ── Date & time ──────────────────────────────────────────
    date:    null,           // ISO date string or null
    time:    "",             // "HH:MM" string

    // ── Outcome / follow-up (spec §14, §15) ──────────────────
    outcome:       "",
    followUpDate:  null,
    followUpNote:  "",

    // ── Priority ─────────────────────────────────────────────
    starred: false,

    // ── Mass email tracking ───────────────────────────────────
    isMassEmail: false,
    recipients:  [],         // [{ email, name, opened }]

    // ── Email open pixel tracking ─────────────────────────────
    emailTracking: null,     // { trackingId, sent, sentAt, opened, openedAt }

    // ── Read tracking ─────────────────────────────────────────
    readBy: [],              // [{ user, readAt }]

    // ── Attachments ───────────────────────────────────────────
    attachments: [],         // [{ fileName, fileUrl, mimeType, fileSize }]

    // ── Meta ──────────────────────────────────────────────────
    createdBy: null,
  },
});

export default ContactHistory;