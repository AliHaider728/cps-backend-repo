/**
 * routes/restrictedClinicianRoutes.js — Restricted Clinician Management
 *
 * Mount in server.js: app.use("/api/restricted-clinicians", restrictedClinicianRoutes);
 *
 * Endpoints organized: GET → POST → DELETE (by resource group)
 * Full Swagger annotations included for all routes
 *
 * Manages clinician restrictions and blocked access at entities (clients/practices)
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";

import {
  listAllRestricted,
  getRestrictedClientsForClinician,
  addRestrictedClient,
  removeRestrictedClient,
  getRestrictedAtClient,
} from "../controllers/restrictedClinicianController.js";

const router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const reader = [
  verifyToken,
  allowRoles(
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training_manager",
    "workforce_manager"
  ),
];

const writer = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];

const admin = [verifyToken, allowRoles("super_admin", "ops_manager")];

/* ═════════════════════════════════════════════════════════ */
/* TAG: RESTRICTED CLINICIANS — GET                           */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/restricted-clinicians:
 *   get:
 *     tags:
 *       - Restricted Clinicians
 *     summary: List all active restrictions
 *     description: Retrieve all active clinician restrictions across the system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: clinicianId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by restricted clinician
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by client entity
 *       - in: query
 *         name: restrictionType
 *         schema:
 *           type: string
 *           enum: [temporary, permanent, compliance, disciplinary]
 *           description: Filter by restriction type
 *       - in: query
 *         name: activeOnly
 *         schema:
 *           type: boolean
 *           default: true
 *           description: Show only active restrictions
 *     responses:
 *       200:
 *         description: List of active restrictions retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RestrictionRecord'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/", ...reader, listAllRestricted);

/**
 * @swagger
 * /api/restricted-clinicians/clinician/{id}/restricted-clients:
 *   get:
 *     tags:
 *       - Restricted Clinicians
 *     summary: Get clients restricted for a clinician
 *     description: Retrieve all clients/entities that a specific clinician is blocked from accessing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Clinician ID
 *       - in: query
 *         name: includeExpired
 *         schema:
 *           type: boolean
 *           default: false
 *           description: Include expired/inactive restrictions
 *     responses:
 *       200:
 *         description: Restricted clients for clinician retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   clinicianId:
 *                     type: string
 *                     format: uuid
 *                   clientId:
 *                     type: string
 *                     format: uuid
 *                   clientName:
 *                     type: string
 *                   restrictionType:
 *                     type: string
 *                     enum: [temporary, permanent, compliance, disciplinary]
 *                   reason:
 *                     type: string
 *                   startDate:
 *                     type: string
 *                     format: date-time
 *                   endDate:
 *                     type: string
 *                     format: date-time
 *                   isActive:
 *                     type: boolean
 *       404:
 *         description: Clinician not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/clinician/:id/restricted-clients",
  ...reader,
  getRestrictedClientsForClinician
);

/**
 * @swagger
 * /api/restricted-clinicians/{entityType}/{entityId}/restricted-clinicians:
 *   get:
 *     tags:
 *       - Restricted Clinicians
 *     summary: Get clinicians restricted at an entity
 *     description: Retrieve all clinicians blocked from accessing a specific client or practice
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [client, practice, pcn]
 *         description: Type of entity
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Entity ID
 *       - in: query
 *         name: includeExpired
 *         schema:
 *           type: boolean
 *           default: false
 *           description: Include expired restrictions
 *     responses:
 *       200:
 *         description: Restricted clinicians at entity retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   clinicianId:
 *                     type: string
 *                     format: uuid
 *                   clinicianName:
 *                     type: string
 *                   clinicianEmail:
 *                     type: string
 *                   restrictionType:
 *                     type: string
 *                     enum: [temporary, permanent, compliance, disciplinary]
 *                   reason:
 *                     type: string
 *                   startDate:
 *                     type: string
 *                     format: date-time
 *                   endDate:
 *                     type: string
 *                     format: date-time
 *                   isActive:
 *                     type: boolean
 *       400:
 *         description: Invalid entity type
 *       404:
 *         description: Entity not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:entityType/:entityId/restricted-clinicians", ...reader, getRestrictedAtClient);

/* ═════════════════════════════════════════════════════════ */
/* TAG: RESTRICTED CLINICIANS — POST                          */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/restricted-clinicians/clinician/{id}/restricted-clients:
 *   post:
 *     tags:
 *       - Restricted Clinicians
 *     summary: Restrict clinician from client
 *     description: Add a restriction preventing a clinician from accessing a specific client or entity
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Clinician ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - restrictionType
 *             properties:
 *               clientId:
 *                 type: string
 *                 format: uuid
 *                 description: Client/entity ID to restrict access to
 *               restrictionType:
 *                 type: string
 *                 enum: [temporary, permanent, compliance, disciplinary]
 *               reason:
 *                 type: string
 *                 description: Reason for restriction
 *               startDate:
 *                 type: string
 *                 format: date-time
 *                 description: "Start date (default: now)"
 *               endDate:
 *                 type: string
 *                 format: date-time
 *                 description: End date (required for temporary restrictions)
 *     responses:
 *       201:
 *         description: Restriction added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 clinicianId:
 *                   type: string
 *                   format: uuid
 *                 clientId:
 *                   type: string
 *                   format: uuid
 *                 restrictionType:
 *                   type: string
 *                 reason:
 *                   type: string
 *                 startDate:
 *                   type: string
 *                   format: date-time
 *                 endDate:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid input (missing endDate for temporary, etc.)
 *       404:
 *         description: Clinician or client not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/clinician/:id/restricted-clients", ...writer, addRestrictedClient);

/* ═════════════════════════════════════════════════════════ */
/* TAG: RESTRICTED CLINICIANS — DELETE                        */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/restricted-clinicians/clinician/{id}/restricted-clients/{recordId}:
 *   delete:
 *     tags:
 *       - Restricted Clinicians
 *     summary: Remove clinician restriction
 *     description: Remove or soft-delete a restriction record (clinician can access entity again)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Clinician ID
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Restriction record ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for removing restriction
 *     responses:
 *       204:
 *         description: Restriction removed successfully
 *       404:
 *         description: Restriction record or clinician not found
 *       400:
 *         description: Cannot remove already expired restriction
 *       403:
 *         description: Insufficient permissions (admin only)
 */
router.delete(
  "/clinician/:id/restricted-clients/:recordId",
  ...admin,
  removeRestrictedClient
);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;