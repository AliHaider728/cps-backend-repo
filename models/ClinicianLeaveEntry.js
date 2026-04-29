import { createModel } from "../lib/model.js";

/**
 * ClinicianLeaveEntry — single leave/absence row.
 * Stored in `app_records` with model = "ClinicianLeaveEntry".
 *
 * Mirrors backend/sql/clinicians/003_clinician_leave.sql
 */

const ClinicianLeaveEntry = createModel({
  modelName: "ClinicianLeaveEntry",
  refs: {
    clinician:  { model: "Clinician" },
    approvedBy: { model: "User" },
    createdBy:  { model: "User" },
  },
  defaults: {
    clinician:  null,
    leaveType:  "annual",   // annual | sick | cppe | other
    contract:   "ARRS",     // ARRS | EA | Direct
    startDate:  null,
    endDate:    null,
    days:       0,          // numeric, supports half-days (e.g. 3.5)
    approved:   false,
    approvedBy: null,
    approvedAt: null,
    notes:      "",
    createdBy:  null,
  },
});

export default ClinicianLeaveEntry;
