import { createModel } from "../lib/model.js";

/**
 * TimeEntry model - Clinician shift time tracking
 * model = "time_entry" in app_records
 */
const TimeEntry = createModel({
  modelName: "time_entry",
  defaults: {
    clinician_id:  null,
    user_id:       null,
    clock_in:      null,
    clock_out:     null,
    planned_hours: null,
    actual_hours:  null,
    status:        "active",
    notes:         "",
    created_by:    null,
    createdAt:     null,
    updatedAt:     null,
  },
});

export default TimeEntry;
