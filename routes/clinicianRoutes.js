/**
 * routes/clinicianRoutes.js — Module 3 (Clinician Management)
 *
 * Mounted at /api/clinicians by server.js.
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
  linkClinicianUser,
  deleteClinician,
  getClientHistory,
  addClientHistory,
  updateClientHistory,
  updateSystemAccess,
  restrictClinician,
  unrestrictClinician,
  updateClinicianUserLogin,
  resetClinicianUserPassword,
} from "../controllers/clinicianController.js";

import {
  getCompliance,
  upsertDoc,
  approveDoc,
  rejectDoc,
} from "../controllers/clinicianComplianceController.js";

import {
  getLeave,
  getMyLeave,
  addLeave,
  updateLeave,
  deleteLeave,
} from "../controllers/leaveController.js";

import {
  getProjectMappings,
  createProjectMapping,
  deleteProjectMapping,
} from "../controllers/projectMappingController.js";

import {
  getLogs    as getSupervisionLogs,
  addLog     as addSupervisionLog,
  updateLog  as updateSupervisionLog,
  deleteLog  as deleteSupervisionLog,
} from "../controllers/supervisionController.js";

import { getCPPE, updateCPPE }               from "../controllers/cppeController.js";
import { updateOnboarding, sendWelcomePack } from "../controllers/onboardingController.js";

const router = Router();

/* role groups */
const reader = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance", "training_manager", "workforce_manager")];
const writer = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const admin  = [verifyToken, allowRoles("super_admin", "ops_manager")];
const clinicianSelf = [verifyToken, allowRoles("clinician", "super_admin")];
const leaveReader = [
  verifyToken,
  allowRoles(
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training_manager",
    "workforce_manager",
    "clinician"
  ),
];
const clinicianLeaveWriter = [verifyToken, allowRoles("clinician", "super_admin", "director", "ops_manager")];

/* ── List + create ─────────────────────────────────────────── */
router.get( "/", ...reader, getClinicians);
router.post("/", ...writer, createClinician);

/* ── Clinician portal (self) — before /:id ─────────────────── */
router.get("/me/leave", ...clinicianSelf, getMyLeave);

/* ── Detail CRUD ───────────────────────────────────────────── */
router.get(   "/:id", ...reader, getClinicianById);
router.put(   "/:id", ...writer, updateClinician);
router.patch( "/:id/link-user", ...admin, linkClinicianUser);
router.patch( "/:id/user-login", ...admin, updateClinicianUserLogin);
router.post(  "/:id/reset-login-password", ...admin, resetClinicianUserPassword);
router.delete("/:id", ...admin,  deleteClinician);

/* ── Tab 3 — Compliance docs ───────────────────────────────── */
router.get(   "/:id/compliance",                ...leaveReader, getCompliance);
router.patch( "/:id/compliance/:docId",         ...writer, upload.single("file"), upsertDoc);
router.post(  "/:id/compliance/:docId/approve", ...admin,  approveDoc);
router.post(  "/:id/compliance/:docId/reject",  ...admin,  rejectDoc);

/* ── Tab 4 — Client history ────────────────────────────────── */
router.get( "/:id/client-history",                                  ...reader, getClientHistory);
router.post("/:id/client-history",                                  ...writer, addClientHistory);
router.put( "/:id/client-history/:recordId",                        ...writer, updateClientHistory);
router.patch("/:id/client-history/:recordId/system-access",         ...writer, updateSystemAccess);

/* ── Tab 5 — Leave ─────────────────────────────────────────── */
router.get(   "/:id/leave",          ...leaveReader, getLeave);
router.post(  "/:id/leave",          ...clinicianLeaveWriter, addLeave);
router.put(   "/:id/leave/:entryId", ...writer, updateLeave);
router.delete("/:id/leave/:entryId", ...writer, deleteLeave);

/* ── Project mapping (finance / admin) ─────────────────────── */
router.get(   "/:id/project-mappings", ...reader, getProjectMappings);
router.post(  "/:id/project-mappings", ...writer, createProjectMapping);
router.delete("/:id/project-mappings/:mappingId", ...writer, deleteProjectMapping);

/* ── Tab 6 — Supervision ───────────────────────────────────── */
router.get(   "/:id/supervision",         ...leaveReader, getSupervisionLogs);
router.post(  "/:id/supervision",         ...writer, addSupervisionLog);
router.put(   "/:id/supervision/:logId",  ...clinicianLeaveWriter, updateSupervisionLog);
router.delete("/:id/supervision/:logId",  ...admin,  deleteSupervisionLog);

/* ── Tab 7 — CPPE ──────────────────────────────────────────── */
router.get("/:id/cppe", ...leaveReader, getCPPE);
router.put("/:id/cppe", ...writer, updateCPPE);

/* ── Tab 8 — Onboarding ────────────────────────────────────── */
router.put( "/:id/onboarding",         ...writer, updateOnboarding);
router.post("/:id/onboarding/welcome", ...admin,  sendWelcomePack);

/* ── Restricted flag (global) ──────────────────────────────── */
router.patch("/:id/restrict",   ...admin, restrictClinician);
router.patch("/:id/unrestrict", ...admin, unrestrictClinician);

export default router;