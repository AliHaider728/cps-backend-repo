import { createModel } from "../lib/model.js";

/**
 * ClinicianClientHistory — past/current PCN + Practice assignments per clinician.
 * Stored in `app_records` with model = "ClinicianClientHistory".
 *
 * Mirrors backend/sql/clinicians/005_clinician_client_history.sql
 */

const ClinicianClientHistory = createModel({
  modelName: "ClinicianClientHistory",
  refs: {
    clinician: { model: "Clinician" },
    pcn:       { model: "PCN" },
    practice:  { model: "Practice" },
    createdBy: { model: "User" },
  },
  defaults: {
    clinician:      null,
    pcn:            null,
    practice:       null,
    contract:       "",          // ARRS | EA | Direct
    startDate:      null,
    endDate:        null,
    status:         "active",    // active | ended | restricted
    systemAccess:   [],          // [{ system, status, requestedAt, grantedAt }]
    isRestricted:   false,
    restrictReason: "",
    createdBy:      null,
  },
});

export default ClinicianClientHistory;
