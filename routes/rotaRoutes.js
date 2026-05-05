/**
 * routes/rotaRoutes.js — Module 5 (Rota & Shift Management)
 *
 * Mounted at /api/rota by server.js.
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles, blockClinicianOnRota } from "../middleware/roleCheck.js";

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
} from "../controllers/rotaController.js";

const router = Router();

/* role groups */
const nonClinicianReader = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"),
];

const clinicianReader = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce")];

const generator = [verifyToken, allowRoles("super_admin", "ops_manager")];
const writer = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager")];
const coverWriter = [verifyToken, blockClinicianOnRota, allowRoles("super_admin", "ops_manager", "workforce")];
const admin = [verifyToken, allowRoles("super_admin", "ops_manager")];

router.get("/", ...nonClinicianReader, getRotaGrid);
router.get("/clinician/:id", ...clinicianReader, getClinicianRota);
router.get("/shift/:id", ...clinicianReader, getRotaById);
router.get("/seed-data", verifyToken, allowRoles("super_admin", "ops_manager"), (req, res) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const seedDataPath = path.join(__dirname, '../seed-data/shifts.json');
    
    // Read the JSON seed data
    const seedData = await fs.readFile(seedDataPath, 'utf8');
    const shifts = JSON.parse(seedData);
    
    return res.status(200).json({
      data: shifts,
      message: "Seed data loaded successfully"
    });
  } catch (error) {
    console.error('Error reading seed data:', error);
    return res.status(500).json({
      message: "Failed to load seed data"
    });
  }
});
router.get("/checks/restricted", verifyToken, blockClinicianOnRota, allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"), checkRestrictedClinicianEntry);
router.get("/checks/compliance", verifyToken, blockClinicianOnRota, allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce"), checkMandatoryComplianceEntry);

router.post("/generate", ...generator, generateMonthlyRota);

router.post("/shift", ...writer, createShift);
router.put("/shift/:id", ...writer, updateShift);
router.delete("/shift/:id", ...admin, deleteShift);

router.get("/gaps", ...nonClinicianReader, getGapReport);
router.post("/cover", ...coverWriter, assignCover);

router.post("/send/:clientId", ...admin, sendRotaToClient);
router.get("/cover-requests", ...nonClinicianReader, getCoverRequests);

export default router;
