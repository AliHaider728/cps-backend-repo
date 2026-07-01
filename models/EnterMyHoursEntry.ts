import { createModel } from "../lib/model.js";

/**
 * EnterMyHoursEntry
 * Separate module from timesheets and shifts.
 * Stored in app_records with model = "EnterMyHoursEntry".
 */
const EnterMyHoursEntry = createModel({
  modelName: "EnterMyHoursEntry",
  refs: {
    clinician: { model: "Clinician" },
    reviewedBy: { model: "User" },
    createdBy: { model: "User" },
  },
  defaults: {
    clinician: null,
    practiceId: "",
    practiceName: "",
    pcn: "",
    assignedShiftRef: "",
    shiftId: "",
    dateWorked: null,
    startTime: "",
    endTime: "",
    breakDurationMinutes: 0,
    totalWorkedHours: 0,
    notes: "",
    submissionStatus: "draft", // draft | submitted
    managerApprovalStatus: "pending", // pending | approved | rejected
    rejectionReason: "",
    reviewedBy: null,
    reviewedAt: null,
    month: null,
    year: null,
    createdBy: null,
  },
});

export default EnterMyHoursEntry;

