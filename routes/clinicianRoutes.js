/**
 * routes/clinicianRoutes.js — Module 3 (Clinician Management)
 *
 * Mounted at /api/clinicians by server.js.
 *
 * Adapted from spec to match existing project middleware:
 *   - verifyToken      (../middleware/auth.js)
 *   - allowRoles(...)  (../middleware/roleCheck.js)
 *   - upload           (../middleware/upload.js)
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import { upload }     from "../middleware/upload.js";

import {
  getClinicians,
  createClinician,
  getClinicianById,
  updateClinician,
  deleteClinician,
  getClientHistory,
  restrictClinician,
  unrestrictClinician,
} from "../controllers/clinicianController.js";

import {
  getCompliance,
  upsertDoc,
  approveDoc,
  rejectDoc,
} from "../controllers/clinicianComplianceController.js";

import {
  getLeave,
  addLeave,
  updateLeave,
  deleteLeave,
} from "../controllers/leaveController.js";

import {
  getLogs    as getSupervisionLogs,
  addLog     as addSupervisionLog,
  updateLog  as updateSupervisionLog,
  deleteLog  as deleteSupervisionLog,
} from "../controllers/supervisionController.js";

import { getCPPE, updateCPPE } from "../controllers/cppeController.js";
import { updateOnboarding, sendWelcomePack } from "../controllers/onboardingController.js";

const router = Router();

/* role groups */
const reader = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance", "training_manager", "workforce_manager")];
const writer = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const admin  = [verifyToken, allowRoles("super_admin", "ops_manager")];

/* ── List + create ─────────────────────────────────────── */
router.get( "/", reader, getClinicians);
router.post("/", writer, createClinician);

/* ── Detail CRUD ───────────────────────────────────────── */
router.get(   "/:id", reader, getClinicianById);
router.put(   "/:id", writer, updateClinician);
router.delete("/:id", admin,  deleteClinician);

/* ── Tab 3 — Compliance docs ───────────────────────────── */
router.get(   "/:id/compliance",                 reader, getCompliance);
router.patch( "/:id/compliance/:docId",          writer, upload.single("file"), upsertDoc);
router.post(  "/:id/compliance/:docId/approve",  admin,  approveDoc);
router.post(  "/:id/compliance/:docId/reject",   admin,  rejectDoc);

/* ── Tab 4 — Client history (read only) ───────────────── */
router.get("/:id/client-history", reader, getClientHistory);

/* ── Tab 5 — Leave ─────────────────────────────────────── */
router.get(   "/:id/leave",             reader, getLeave);
router.post(  "/:id/leave",             writer, addLeave);
router.put(   "/:id/leave/:entryId",    writer, updateLeave);
router.delete("/:id/leave/:entryId",    writer, deleteLeave);

/* ── Tab 6 — Supervision ───────────────────────────────── */
router.get(   "/:id/supervision",          reader, getSupervisionLogs);
router.post(  "/:id/supervision",          writer, addSupervisionLog);
router.put(   "/:id/supervision/:logId",   writer, updateSupervisionLog);
router.delete("/:id/supervision/:logId",   admin,  deleteSupervisionLog);

/* ── Tab 7 — CPPE ──────────────────────────────────────── */
router.get("/:id/cppe", reader, getCPPE);
router.put("/:id/cppe", writer, updateCPPE);

/* ── Tab 8 — Onboarding ────────────────────────────────── */
router.put( "/:id/onboarding",         writer, updateOnboarding);
router.post("/:id/onboarding/welcome", admin,  sendWelcomePack);

/* ── Restricted flag ───────────────────────────────────── */
router.patch("/:id/restrict",   admin, restrictClinician);
router.patch("/:id/unrestrict", admin, unrestrictClinician);

export default router;
