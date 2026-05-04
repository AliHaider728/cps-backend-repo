/**
 * routes/restrictedClinicianRoutes.js — Module 3
 *
 * Mounted at /api/restricted-clinicians by server.js.
 *
 * Routes:
 *   GET    /                                            → list all active restrictions
 *   GET    /clinician/:id/restricted-clients            → clients this clinician is blocked from
 *   POST   /clinician/:id/restricted-clients            → add a per-client restriction
 *   DELETE /clinician/:id/restricted-clients/:recordId  → soft-remove a restriction
 *   GET    /:entityType/:entityId/restricted-clinicians → clinicians blocked at a client
 */

import { Router }       from "express";
import { verifyToken }  from "../middleware/auth.js";
import { allowRoles }   from "../middleware/roleCheck.js";

import {
  listAllRestricted,
  getRestrictedClientsForClinician,
  addRestrictedClient,
  removeRestrictedClient,
  getRestrictedAtClient,
} from "../controllers/restrictedClinicianController.js";

const router = Router();

const reader = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance", "training_manager", "workforce_manager")];
const writer = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const admin  = [verifyToken, allowRoles("super_admin", "ops_manager")];

/* ── List all active restrictions ──────────────────────────── */
router.get("/", ...reader, listAllRestricted);

/* ── Per-clinician restricted clients ──────────────────────── */
router.get(   "/clinician/:id/restricted-clients",              ...reader, getRestrictedClientsForClinician);
router.post(  "/clinician/:id/restricted-clients",              ...writer, addRestrictedClient);
router.delete("/clinician/:id/restricted-clients/:recordId",    ...admin,  removeRestrictedClient);

/* ── Restricted clinicians at a client ─────────────────────── */
router.get("/:entityType/:entityId/restricted-clinicians", ...reader, getRestrictedAtClient);

export default router;