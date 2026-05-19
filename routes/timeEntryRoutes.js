import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  getActiveEntry,
  clockIn,
  clockOut,
  getTimeEntries,
  getAdminSummary,
  getClinicianTimeEntriesAdmin,
} from "../controllers/timeEntryController.js";

const router = Router();

const clinicianOnly = [verifyToken, allowRoles("clinician")];
const adminOnly = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce")];

router.get("/active", ...clinicianOnly, getActiveEntry);
router.post("/clock-in", ...clinicianOnly, clockIn);
router.post("/clock-out", ...clinicianOnly, clockOut);
router.get("/admin/summary", ...adminOnly, getAdminSummary);
router.get("/admin/clinician/:clinicianId", ...adminOnly, getClinicianTimeEntriesAdmin);
router.get("/", ...clinicianOnly, getTimeEntries);

export default router;
