import { createModel } from "../lib/model.js";

/**
 * ContactHistory model
 *
 * UPDATED (Apr 2026):
 *   - Added: notes, date, time fields (were missing — controller was using them → bug)
 *   - Added: isMassEmail, recipients (mass email tracking)
 *   - Added: readBy (track who read a specific log entry)
 *   - Added: outcome, followUpDate, followUpNote (ops wishlist)
 *   - Kept:  starred, emailTracking, attachments, detail
 */

const ContactHistory = createModel({
  modelName: "ContactHistory",
  refs: {
    createdBy: { model: "User" },
    readBy:    { model: "User" },
  },
  defaults: {
    // ── Entity reference ───────────────────────────────────
    entityType: "",          // "PCN" | "Practice" | "Federation" | "ICB"
    entityId:   "",

    // ── Log type ───────────────────────────────────────────
    // note | email | call | meeting | complaint | document
    // system_access | contract | other
    type:    "note",
    subject: "",

    // ── Content ────────────────────────────────────────────
    notes:   "",             // FIX: was missing — controller uses `notes`
    detail:  "",             // kept for backwards compat

    // ── Date & time ────────────────────────────────────────
    date:    null,           // FIX: was missing — controller uses `date`
    time:    "",             // FIX: was missing — controller uses `time`

    // ── Outcome / follow-up ────────────────────────────────
    outcome:       "",
    followUpDate:  null,
    followUpNote:  "",

    // ── Priority ───────────────────────────────────────────
    starred: false,

    // ── Mass email ─────────────────────────────────────────
    isMassEmail: false,      // FIX: was missing
    recipients:  [],         // FIX: was missing — [{ email, name, opened }]

    // ── Email open tracking ────────────────────────────────
    emailTracking: null,     // { trackingId, sent, sentAt, opened, openedAt }

    // ── Read tracking ──────────────────────────────────────
    readBy: [],              // [{ user, readAt }]

    // ── Attachments ────────────────────────────────────────
    attachments: [],         // [{ fileName, fileUrl, mimeType, fileSize }]

    // ── Meta ───────────────────────────────────────────────
    createdBy: null,
  },
});

export default ContactHistory;