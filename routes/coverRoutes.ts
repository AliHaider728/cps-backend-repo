/**
 * routes/coverRoutes.js — Cover & Locum Management
 *
 * Mount in server.js: app.use("/api/cover", coverRoutes);
 *
 * Endpoints organized: GET → POST → PUT (by resource group)
 * Full Swagger annotations included for all routes
 *
 * Manages cover requests, assignments, and clinician availability for shift coverage
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import checkRestricted from "../middleware/checkRestricted.js";
import {
  assignCoverRequest,
  createCoverRequest,
  getOpenCoverRequests,
  updateCoverStatus,
} from "../controllers/coverController.js";

const router = express.Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const MANAGERS = [
  "super_admin",
  "ops_manager",
  "workforce",
  "director",
];

const managerAuth = [
  verifyToken,
  allowRoles(...MANAGERS),
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: COVER REQUESTS — GET                                  */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/cover/open:
 *   get:
 *     tags:
 *       - Cover Requests
 *     summary: Get open cover requests
 *     description: Retrieve all open/pending cover requests requiring assignment or clinician response
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, pending_assignment, assigned, filled, cancelled]
 *           description: Filter by cover request status
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *           description: Filter by shift date (from)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *           description: Filter by shift date (to)
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by department
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by client
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [low, medium, high, urgent]
 *           description: Filter by priority level
 *     responses:
 *       200:
 *         description: Open cover requests retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CoverRequest'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 summary:
 *                   type: object
 *                   properties:
 *                     open:
 *                       type: integer
 *                     pending:
 *                       type: integer
 *                     urgent:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (managers only)
 */
router.get("/open", ...managerAuth, getOpenCoverRequests);

/* ═════════════════════════════════════════════════════════ */
/* TAG: COVER REQUESTS — POST                                 */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/cover/create:
 *   post:
 *     tags:
 *       - Cover Requests
 *     summary: Create cover request
 *     description: Create a new cover request for shift coverage (absence, leave, or vacancy)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientId
 *               - shiftDate
 *               - shiftType
 *             properties:
 *               clientId:
 *                 type: string
 *                 format: uuid
 *                 description: Client requiring cover
 *               clinicianId:
 *                 type: string
 *                 format: uuid
 *                 description: Clinician going on leave (if applicable)
 *               shiftDate:
 *                 type: string
 *                 format: date
 *                 description: Date requiring cover
 *               shiftType:
 *                 type: string
 *                 enum: [full_day, morning, afternoon, evening, night, custom]
 *                 description: Type of shift to cover
 *               startTime:
 *                 type: string
 *                 format: time
 *                 description: Start time (required for custom shifts)
 *               endTime:
 *                 type: string
 *                 format: time
 *                 description: End time (required for custom shifts)
 *               reason:
 *                 type: string
 *                 enum: [leave, absence, sick, vacancy, other]
 *                 description: Reason for cover request
 *               description:
 *                 type: string
 *                 description: Additional details about the cover requirement
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high, urgent]
 *                 default: medium
 *               specialRequirements:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Special skills or certifications needed
 *               numberOfClinicians:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of clinicians needed for cover
 *     responses:
 *       201:
 *         description: Cover request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverRequest'
 *       400:
 *         description: Invalid input (missing required fields, invalid dates)
 *       404:
 *         description: Client or clinician not found
 *       403:
 *         description: Insufficient permissions (managers only)
 */
router.post("/create", ...managerAuth, createCoverRequest);

/**
 * @swagger
 * /api/cover/{id}/assign:
 *   post:
 *     tags:
 *       - Cover Requests
 *     summary: Assign clinician to cover request
 *     description: Assign a clinician to a specific cover request (respects restrictions)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Cover request ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clinicianId
 *             properties:
 *               clinicianId:
 *                 type: string
 *                 format: uuid
 *                 description: Clinician to assign to cover
 *               notes:
 *                 type: string
 *                 description: Assignment notes or special instructions
 *               confirmationRequired:
 *                 type: boolean
 *                 default: true
 *                 description: Whether clinician confirmation is required
 *               payGrade:
 *                 type: string
 *                 description: Pay grade/rate for this assignment
 *               contactClinicianImmediately:
 *                 type: boolean
 *                 default: false
 *                 description: Send immediate notification to clinician
 *     responses:
 *       200:
 *         description: Clinician assigned to cover
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverRequest'
 *       400:
 *         description: Invalid assignment (clinician unavailable, restricted, or over-allocated)
 *       404:
 *         description: Cover request or clinician not found
 *       403:
 *         description: Insufficient permissions or clinician is restricted at this client
 *       409:
 *         description: Clinician already assigned to this shift or has conflict
 */
router.post("/:id/assign", ...managerAuth, checkRestricted, assignCoverRequest);

/* ═════════════════════════════════════════════════════════ */
/* TAG: COVER REQUESTS — PUT                                  */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/cover/{id}/status:
 *   put:
 *     tags:
 *       - Cover Requests
 *     summary: Update cover request status
 *     description: Update cover request status (filled, cancelled, completed) or reassign/unassign clinician
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Cover request ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [open, pending_assignment, assigned, filled, cancelled, completed, on_hold]
 *                 description: New status for cover request
 *               notes:
 *                 type: string
 *                 description: Status update notes or reason (e.g., cancellation reason)
 *               reassignClinician:
 *                 type: string
 *                 format: uuid
 *                 description: Replace assigned clinician with new one (optional)
 *               completionTime:
 *                 type: string
 *                 format: time
 *                 description: Actual completion time (if completing early/late)
 *               hoursCovered:
 *                 type: number
 *                 description: Actual hours covered (may differ from planned)
 *               feedback:
 *                 type: string
 *                 description: Feedback or observations about the cover
 *     responses:
 *       200:
 *         description: Cover request status updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoverRequest'
 *       400:
 *         description: Invalid status transition or missing required data
 *       404:
 *         description: Cover request not found
 *       403:
 *         description: Insufficient permissions (managers only)
 *       409:
 *         description: Cannot update - shift date has passed or request already completed
 */
router.put("/:id/status", ...managerAuth, updateCoverStatus);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;