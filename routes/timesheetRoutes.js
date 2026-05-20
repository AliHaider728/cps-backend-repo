import express from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  adminApproveTimesheet,
  adminGetClinicianTimesheet,
  adminGetTimesheets,
  approveTimesheet,
  getMyTimesheet,
  getPendingTimesheets,
  getTimesheetDetail,
  getTimesheetHistory,
  rejectTimesheet,
  submitTimesheet,
  updateTimesheetEntry,
} from "../controllers/timesheetController.js";

const router = express.Router();
const CLINICIAN = ["clinician"];
const APPROVERS = ["super_admin", "ops_manager"];
const REVIEWERS = ["super_admin", "ops_manager", "finance", "director"];

router.use(authenticate);

// ── Clinician (self) ──────────────────────────────────────────────────────
router.get("/my",              allowRoles(...CLINICIAN), getMyTimesheet);
router.get("/my/:month/:year", allowRoles(...CLINICIAN), getMyTimesheet);
router.put("/entries/:id",     allowRoles(...CLINICIAN), updateTimesheetEntry);
router.post("/submit",         allowRoles(...CLINICIAN), submitTimesheet);

// ── Approvals ─────────────────────────────────────────────────────────────
router.get("/pending",       allowRoles(...APPROVERS), getPendingTimesheets);
router.get("/history",       allowRoles(...REVIEWERS), getTimesheetHistory);
router.get("/:id/detail",    allowRoles(...REVIEWERS), getTimesheetDetail);
router.post("/:id/approve",  allowRoles(...APPROVERS), approveTimesheet);
router.post("/:id/reject",   allowRoles(...APPROVERS), rejectTimesheet);

// ── Admin ─────────────────────────────────────────────────────────────────
router.get("/admin",                          allowRoles(...REVIEWERS), adminGetTimesheets);
router.get("/admin/clinician/:clinicianId",   allowRoles(...REVIEWERS), adminGetClinicianTimesheet);
router.patch("/admin/:id/review",             allowRoles(...APPROVERS), adminApproveTimesheet);

//  FIX: CalendarPanel calls GET /timesheets/clinician/:id — this route was missing
router.get("/clinician/:clinicianId",         allowRoles(...REVIEWERS), adminGetClinicianTimesheet);

export default router;