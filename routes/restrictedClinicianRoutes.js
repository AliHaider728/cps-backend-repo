/**
 * routes/restrictedClinicianRoutes.js — Module 3
 *
 * Endpoints for managing per-client clinician restrictions.
 *
 * Routes:
 *   GET    /                                → list all active restrictions (with filters)
 *   GET    /clinician/:id/restricted-clients  → list clients this clinician is restricted FROM
 *   POST   /clinician/:id/restricted-clients  → add a per-client restriction
 *   DELETE /clinician/:id/restricted-clients/:recordId → soft-remove a restriction
 *   GET    /:entityType/:entityId/restricted-clinicians → list clinicians restricted at a client
 */

import express from "express";
import {
  listAllRestricted,
  getRestrictedClientsForClinician,
  addRestrictedClient,
  removeRestrictedClient,
  getRestrictedAtClient,
} from "../controllers/restrictedClinicianController.js";
import { asyncHandler } from "../lib/asyncHandler.js";

const router = express.Router();

// GET all restricted records (with optional filters)
router.get("/", asyncHandler(listAllRestricted));

// GET restricted clients for a specific clinician
router.get(
  "/clinician/:id/restricted-clients",
  asyncHandler(getRestrictedClientsForClinician)
);

// POST add a per-client restriction for a clinician
router.post(
  "/clinician/:id/restricted-clients",
  asyncHandler(addRestrictedClient)
);

// DELETE (soft) remove a per-client restriction
router.delete(
  "/clinician/:id/restricted-clients/:recordId",
  asyncHandler(removeRestrictedClient)
);

// GET restricted clinicians at a specific client (entityType/entityId)
router.get(
  "/:entityType/:entityId/restricted-clinicians",
  asyncHandler(getRestrictedAtClient)
);

export default router;