/**
 * routes/enterMyHoursRoutes.js — Hours Entry & Time Tracking
 *
 * Mount in server.js: app.use("/api/hours", enterMyHoursRoutes);
 *
 * Endpoints organized: GET → POST → PATCH (by resource group)
 * Full Swagger annotations included for all routes
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  getMyEnterHours,
  upsertMyEnterHours,
  submitMyEnterHours,
  listManagerEnterHours,
  reviewManagerEnterHours,
} from "../controllers/enterMyHoursController.js";

const router: Router = express.Router();

/* ─────────────────────────────────────────────────────────── */
/* MIDDLEWARE                                                  */
/* ─────────────────────────────────────────────────────────── */

router.use(verifyToken);

const clinicianOnly = allowRoles("clinician");

const managerRoles = allowRoles(
  "super_admin",
  "ops_manager",
  "workforce",
  "director",
  "finance"
);

/* ═════════════════════════════════════════════════════════ */
/* TAG: MY HOURS ENTRY — GET                                  */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/hours/my:
 *   get:
 *     tags:
 *       - My Hours Entry
 *     summary: Get my hours entry
 *     description: Retrieve current user's (clinician's) hours entry draft and submission history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           format: date
 *           description: Period date to fetch hours for (YYYY-MM-DD)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, submitted, approved, rejected]
 *     responses:
 *       200:
 *         description: Clinician's hours entry retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HoursEntry'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (clinician role required)
 */
router.get("/my", clinicianOnly, getMyEnterHours);

/* ═════════════════════════════════════════════════════════ */
/* TAG: MY HOURS ENTRY — POST                                 */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/hours/my/upsert:
 *   post:
 *     tags:
 *       - My Hours Entry
 *     summary: Upsert hours entry draft
 *     description: Create or update draft hours entry (does not lock or submit)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - period
 *               - entries
 *             properties:
 *               period:
 *                 type: string
 *                 format: date
 *                 description: Period date (start of period, e.g., YYYY-MM-DD)
 *               entries:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       format: date
 *                     projectId:
 *                       type: string
 *                       format: uuid
 *                     hours:
 *                       type: number
 *                       minimum: 0
 *                       maximum: 24
 *                     notes:
 *                       type: string
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *     responses:
 *       201:
 *         description: Hours entry created/updated as draft
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HoursEntry'
 *       400:
 *         description: Invalid input (dates, hours, projects)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post("/my/upsert", clinicianOnly, upsertMyEnterHours);

/**
 * @swagger
 * /api/hours/my/submit:
 *   post:
 *     tags:
 *       - My Hours Entry
 *     summary: Submit hours entry for approval
 *     description: Finalize and submit hours entry to manager for review and approval
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               period:
 *                 type: string
 *                 format: date
 *               comment:
 *                 type: string
 *                 description: Optional submission comment for manager
 *     responses:
 *       200:
 *         description: Hours entry submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HoursEntry'
 *       400:
 *         description: Cannot submit - missing required data or already submitted
 *       404:
 *         description: Hours entry not found
 *       401:
 *         description: Unauthorized
 */
router.post("/my/submit", clinicianOnly, submitMyEnterHours);

/* ═════════════════════════════════════════════════════════ */
/* TAG: MANAGER HOURS REVIEW — GET                            */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/hours/manager:
 *   get:
 *     tags:
 *       - Manager Hours Review
 *     summary: List hours entries for manager review
 *     description: Retrieve all submitted hours entries for team clinicians (manager/admin view)
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
 *           enum: [submitted, approved, rejected, under_review]
 *       - in: query
 *         name: clinicianId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: periodFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: periodTo
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Hours entries for review retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/HoursEntryForReview'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (manager role required)
 */
router.get("/manager", managerRoles, listManagerEnterHours);

/* ═════════════════════════════════════════════════════════ */
/* TAG: MANAGER HOURS REVIEW — PATCH                          */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/hours/manager/{id}/review:
 *   patch:
 *     tags:
 *       - Manager Hours Review
 *     summary: Review and approve/reject hours entry
 *     description: Manager reviews submitted hours and either approves or rejects with feedback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Hours entry ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *               feedback:
 *                 type: string
 *                 description: Manager's feedback or rejection reason
 *               adjustments:
 *                 type: array
 *                 description: Optional hour adjustments by line item
 *                 items:
 *                   type: object
 *                   properties:
 *                     entryId:
 *                       type: string
 *                       format: uuid
 *                     adjustedHours:
 *                       type: number
 *                     reason:
 *                       type: string
 *     responses:
 *       200:
 *         description: Hours entry reviewed and updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HoursEntry'
 *       400:
 *         description: Invalid action or status
 *       404:
 *         description: Hours entry not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (manager only)
 */
router.patch("/manager/:id/review", managerRoles, reviewManagerEnterHours);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;