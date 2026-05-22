import { Router } from "express";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles, allowClinicianSelfOrRoles, blockClinicianOnRota } from "../middleware/roleCheck.js";
import {
  getMonthlyRota,
  getClinicianRota,
  getMyRota,
  getRotaById,
  generateMonthlyRotaFromPatterns,
  createBulkShifts,
  createShift,
  updateShift,
  deleteShift,  
  getRotaGaps,
  assignCover,
  sendRotaToClient,
  sendRotaToClients,
  getCoverRequests,
  getTimesheetForMonth,
  upsertTimesheetEntryForShift,
  updateTimesheetEntry,
  submitTimesheet,
  getPendingTimesheets,
  getTimesheetDetail,
  getClinicianTimesheetForAdmin,
  approveTimesheet,
  rejectTimesheet,
  checkRestrictedClinicianEntry,
  checkMandatoryComplianceEntry,
  seedShiftsFromJson,
} from "../controllers/rotaController.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rotaReaders = [verifyToken, allowRoles("super_admin", "ops_manager", "workforce", "director", "finance", "training")];
const gapReaders = [verifyToken, allowRoles("super_admin", "ops_manager", "workforce", "director")];
const generator = [verifyToken, allowRoles("super_admin", "ops_manager")];
const writer = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager")];
const rotaEntryWriter = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager", "workforce", "director")];
const coverWriter = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager", "workforce")];
const clinicianOnly = [verifyToken, allowRoles("clinician")];
const adminTimesheets = [verifyToken, allowRoles("super_admin", "ops_manager", "finance")];

router.post("/generate", ...generator, generateMonthlyRotaFromPatterns);
router.get("/", ...rotaReaders, getMonthlyRota);
router.get("/gaps", ...gapReaders, getRotaGaps);
router.post("/send-to-clients", ...generator, sendRotaToClients);

router.get("/my", ...clinicianOnly, getMyRota);
router.get("/timesheet/my", ...clinicianOnly, getTimesheetForMonth);
router.put("/timesheet/shift/:shiftId", ...clinicianOnly, upsertTimesheetEntryForShift);
router.put("/timesheet/entry/:id", ...clinicianOnly, updateTimesheetEntry);
router.post("/timesheet/:id/submit", ...clinicianOnly, submitTimesheet);

router.get("/timesheets/pending", ...adminTimesheets, getPendingTimesheets);
router.get("/timesheets/clinician/:clinicianId", ...adminTimesheets, getClinicianTimesheetForAdmin);
router.get("/timesheets/:id/detail", ...adminTimesheets, getTimesheetDetail);
router.post("/timesheets/:id/approve", ...generator, approveTimesheet);
router.post("/timesheets/:id/reject", ...generator, rejectTimesheet);

router.get(
  "/clinician/:id",
  verifyToken,
  allowClinicianSelfOrRoles("id", "super_admin", "director", "ops_manager", "finance", "training", "workforce"),
  getClinicianRota
);
router.get("/shift/:id", ...rotaReaders, getRotaById);
router.get("/cover-requests", ...rotaReaders, getCoverRequests);
router.get("/seed-data", ...generator, async (req, res) => {
  try {
    const seedDataPath = join(__dirname, "../seed-data/shifts.json");
    const seedData = await readFile(seedDataPath, "utf8");
    return res.status(200).json({ data: JSON.parse(seedData), message: "Seed data loaded successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load seed data" });
  }
});

router.get(
  "/checks/restricted",
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
  checkRestrictedClinicianEntry
);
router.get(
  "/checks/compliance",
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
  checkMandatoryComplianceEntry
);

router.post("/bulk", ...rotaEntryWriter, createBulkShifts);
router.post("/shift", ...writer, createShift);
router.patch("/shift/:id", ...writer, updateShift);
router.delete("/shift/:id", ...generator, deleteShift);
router.post("/cover", ...coverWriter, assignCover);
router.post("/send/:clientId", ...generator, sendRotaToClient);
router.post("/seed-shifts", verifyToken, allowRoles("super_admin"), seedShiftsFromJson);

export default router;
