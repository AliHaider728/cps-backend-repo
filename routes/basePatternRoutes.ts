/**
 * routes/basePatternRoutes.ts
 *
 * Mounted at /api/base-patterns by server.js.
 */

import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  createBasePattern,
  deactivateBasePattern,
  getClinicianBasePatterns,
  updateBasePattern,
} from "../controllers/basePatternController.js";

const router = Router();
const MANAGERS = ["super_admin", "ops_manager", "finance", "director"];

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   - name: BasePattern - GET
 *     description: Read / fetch endpoints
 *   - name: BasePattern - POST
 *     description: Create / action endpoints
 *   - name: BasePattern - PUT
 *     description: Update endpoints
 *   - name: BasePattern - DELETE
 *     description: Delete endpoints
 */

/* ===========================================================
 *  GET ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/base-patterns/{clinician_id}:
 *   get:
 *     summary: Get base patterns for a clinician
 *     tags: [BasePattern - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinician_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Clinician ID
 *     responses:
 *       200:
 *         description: List of base patterns
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Clinician not found
 */
router.get("/:clinician_id", allowRoles(...MANAGERS, "clinician"), getClinicianBasePatterns);


/* ===========================================================
 *  POST ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/base-patterns:
 *   post:
 *     summary: Create a new base pattern
 *     tags: [BasePattern - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Base pattern payload
 *     responses:
 *       201:
 *         description: Base pattern created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", allowRoles(...MANAGERS), createBasePattern);


/* ===========================================================
 *  PUT ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/base-patterns/{id}:
 *   put:
 *     summary: Update a base pattern by ID
 *     tags: [BasePattern - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Base pattern ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated base pattern fields
 *     responses:
 *       200:
 *         description: Base pattern updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Base pattern not found
 */
router.put("/:id", allowRoles(...MANAGERS), updateBasePattern);


/* ===========================================================
 *  DELETE ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/base-patterns/{id}:
 *   delete:
 *     summary: Deactivate (soft-delete) a base pattern by ID
 *     tags: [BasePattern - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Base pattern ID
 *     responses:
 *       200:
 *         description: Base pattern deactivated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Base pattern not found
 */
router.delete("/:id", allowRoles(...MANAGERS), deactivateBasePattern);

export default router;
