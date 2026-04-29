/**
 * models/RestrictedClinician.js — Module 3
 *
 * Tracks per-client restrictions (clinician cannot be placed at a specific
 * practice / PCN / surgery). This is SEPARATE from the global isRestricted
 * flag on the Clinician model, which blocks the clinician system-wide.
 *
 * A row here means: "clinician X cannot be placed at client Y (entityType/entityId)"
 * and is surfaced as a hard-block flag in rota + bookings.
 */

import { createModel } from "../lib/model.js";

const RestrictedClinician = createModel({
  modelName: "RestrictedClinician",
  refs: {
    clinician: { model: "Clinician" },
    addedBy:   { model: "User" },
    removedBy: { model: "User" },
  },
  defaults: {
    // Which clinician is restricted
    clinician:    null,

    // Which client entity they're restricted FROM
    entityType:   "practice",   // practice | pcn | surgery
    entityId:     "",           // the entity's _id

    // Why
    reason:       "",
    notes:        "",

    // Who added it + when (createdAt handled by createModel)
    addedBy:      null,
    addedAt:      null,

    // Active flag — soft-delete so audit trail is preserved
    isActive:     true,
    removedAt:    null,
    removedBy:    null,
    removeReason: "",
  },
});

export default RestrictedClinician;