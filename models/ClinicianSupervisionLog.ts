import { createModel } from "../lib/model.js";

/**
 * ClinicianSupervisionLog — RAG-rated supervision session record.
 * Stored in `app_records` with model = "ClinicianSupervisionLog".
 *
 * Mirrors backend/sql/clinicians/004_clinician_supervision.sql
 */

const ClinicianSupervisionLog = createModel({
  modelName: "ClinicianSupervisionLog",
  refs: {
    clinician:  { model: "Clinician" },
    supervisor: { model: "User" },
    createdBy:  { model: "User" },
  },
  defaults: {
    clinician:    null,
    sessionDate:  null,
    ragStatus:    "green",   // red | amber | green
    notes:        "",
    actionItems:  [],        // [{ text, dueDate, done }]
    supervisor:   null,
    createdBy:    null,
  },
});

export default ClinicianSupervisionLog;
