/**
 * routes/rotaRoutes.js — Module 5 (Rota & Shift Management)
 *
 * Mounted at /api/rota by server.js.
 *
 * CHANGES vs previous version:
 *  ✅ Added POST /seed-shifts  → seedShiftsFromJson (was in controller but missing from routes)
 *  ✅ Changed PUT  /shift/:id  → PATCH (REST convention, matches frontend useRota hook)
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import {
  allowRoles,
  blockClinicianOnRota,
  allowClinicianSelfOrRoles,
} from "../middleware/roleCheck.js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  getRotaGrid,
  getClinicianRota,
  getRotaById,
  generateMonthlyRota,
  createShift,
  updateShift,
  deleteShift,
  getGapReport,
  assignCover,
  sendRotaToClient,
  getCoverRequests,
  checkRestrictedClinicianEntry,
  checkMandatoryComplianceEntry,
  seedShiftsFromJson,               // ✅ NEW import
} from "../controllers/rotaController.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ── Role groups ──────────────────────────────────────────────────────────── */
const nonClinicianReader = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
];

const clinicianDiaryReader = [
  verifyToken,
  allowClinicianSelfOrRoles(
    "id",
    "super_admin", "director", "ops_manager", "finance", "training", "workforce"
  ),
];

const clinicianReader = [
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
];

const generator  = [verifyToken, allowRoles("super_admin", "ops_manager")];
const writer     = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager")];
const coverWriter = [
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "ops_manager", "workforce"),
];
const admin      = [verifyToken, allowRoles("super_admin", "ops_manager")];

/* ── Read routes ──────────────────────────────────────────────────────────── */
router.get("/",                ...nonClinicianReader, getRotaGrid);
router.get("/clinician/:id",   ...clinicianDiaryReader, getClinicianRota);
router.get("/shift/:id",       ...clinicianReader, getRotaById);
router.get("/gaps",            ...nonClinicianReader, getGapReport);
router.get("/cover-requests",  ...nonClinicianReader, getCoverRequests);

/* ── Compliance / restriction checks ─────────────────────────────────────── */
router.get(
  "/checks/restricted",
  verifyToken, blockClinicianOnRota,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
  checkRestrictedClinicianEntry
);
router.get(
  "/checks/compliance",
  verifyToken, blockClinicianOnRota,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
  checkMandatoryComplianceEntry
);

/* ── Seed data preview (GET — returns JSON without inserting) ─────────────── */
router.get(
  "/seed-data",
  verifyToken, allowRoles("super_admin", "ops_manager"),
  async (req, res) => {
    try {
      const seedDataPath = join(__dirname, "../seed-data/shifts.json");
      const seedData = await readFile(seedDataPath, "utf8");
      const shifts = JSON.parse(seedData);
      return res.status(200).json({ data: shifts, message: "Seed data loaded successfully" });
    } catch (error) {
      console.error("Error reading seed data:", error);
      return res.status(500).json({ message: "Failed to load seed data" });
    }
  }
);

/* ── Write routes ─────────────────────────────────────────────────────────── */
router.post("/generate",     ...generator, generateMonthlyRota);

router.post("/shift",        ...writer, createShift);
router.patch("/shift/:id",   ...writer, updateShift);          // ✅ PATCH (was PUT)
router.delete("/shift/:id",  ...admin, deleteShift);

router.post("/cover",        ...coverWriter, assignCover);
router.post("/send/:clientId", ...admin, sendRotaToClient);

/* ── ✅ NEW: Seed shifts from JSON into DB (POST — actually inserts) ──────── */
router.post(
  "/seed-shifts",
  verifyToken, allowRoles("super_admin"),
  seedShiftsFromJson
);

export default router;