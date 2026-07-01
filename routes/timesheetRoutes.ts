/**
 * routes/timesheetRoutes.ts — Clinician Timesheet Management
 *
 * Mount in server.js: app.use("/api/timesheets", timesheetRoutes);
 *
 * Endpoints organized: GET → POST → PUT → PATCH
 * Full Swagger annotations included for all routes
 */

import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  adminApproveTimesheet,
  adminGetClinicianTimesheet,
  adminGetTimesheets,
  approveTimesheet,
  getMyTimesheet,
  getPendingTimesheets,
  getTimesheetDetail,
  getTimesheetHistory,
  rejectTimesheet,
  submitTimesheet,
  updateTimesheetEntry,
} from "../controllers/timesheetController.js";

const router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const clinicianOnly = [authenticate, allowRoles("clinician")];
const approversOnly = [authenticate, allowRoles("super_admin", "ops_manager")];
const reviewersOnly = [authenticate, allowRoles("super_admin", "ops_manager", "finance", "director")];

/* ═════════════════════════════════════════════════════════ */
/* TAG: TIMESHEET MANAGEMENT — GET                            */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/timesheets/my:
 *   get:
 *     tags:
 *       - Timesheet Management
 *     summary: Get my current timesheet
 *     description: Retrieve the authenticated clinician's personal timesheet
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Timesheet retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/my", ...clinicianOnly, getMyTimesheet);

/**
 * @swagger
 * /api/timesheets/my/{month}/{year}:
 *   get:
 *     tags:
 *       - Timesheet Management
 *     summary: Get my timesheet by month/year
 *     description: Retrieve authenticated clinician's timesheet for a specific period
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: month
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: year
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Monthly timesheet retrieved
 */
router.get("/my/:month/:year", ...clinicianOnly, getMyTimesheet);

/**
 * @swagger
 * /api/timesheets/pending:
 *   get:
 *     tags:
 *       - Timesheet Approval
 *     summary: Get all pending timesheets
 *     description: Retrieve list of timesheets awaiting approval (Ops/Admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending timesheets
 */
router.get("/pending", ...approversOnly, getPendingTimesheets);

/**
 * @swagger
 * /api/timesheets/history:
 *   get:
 *     tags:
 *       - Timesheet Approval
 *     summary: Get timesheet history
 *     description: Retrieve historical approved/rejected timesheets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: History retrieved
 */
router.get("/history", ...reviewersOnly, getTimesheetHistory);

/**
 * @swagger
 * /api/timesheets/admin:
 *   get:
 *     tags:
 *       - Timesheet Administration
 *     summary: Get all timesheets (Admin View)
 *     description: Detailed list of all timesheets in the system for administrative review
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin timesheet list retrieved
 */
router.get("/admin", ...reviewersOnly, adminGetTimesheets);

/**
 * @swagger
 * /api/timesheets/admin/clinician/{clinicianId}:
 *   get:
 *     tags:
 *       - Timesheet Administration
 *     summary: Get timesheets for a specific clinician
 *     description: Admin/Reviewer access to a specific clinician's timesheet logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicianId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Clinician records retrieved
 */
router.get("/admin/clinician/:clinicianId", ...reviewersOnly, adminGetClinicianTimesheet);

/**
 * @swagger
 * /api/timesheets/clinician/{clinicianId}:
 *   get:
 *     tags:
 *       - Timesheet Administration
 *     summary: Get clinician timesheet (Shortcut)
 *     description: direct access route often used by UI panels
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicianId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Records retrieved
 */
router.get("/clinician/:clinicianId", ...reviewersOnly, adminGetClinicianTimesheet);

/**
 * @swagger
 * /api/timesheets/{id}/detail:
 *   get:
 *     tags:
 *       - Timesheet Management
 *     summary: Get specific timesheet details
 *     description: Retrieve full breakdown and entries of a single timesheet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detail retrieved
 *       404:
 *         description: Timesheet not found
 */
router.get("/:id/detail", ...reviewersOnly, getTimesheetDetail);

/* ═════════════════════════════════════════════════════════ */
/* TAG: TIMESHEET MANAGEMENT — POST                           */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/timesheets/submit:
 *   post:
 *     tags:
 *       - Timesheet Management
 *     summary: Submit current timesheet
 *     description: Mark personal timesheet as submitted for manager review
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully submitted
 */
router.post("/submit", ...clinicianOnly, submitTimesheet);

/**
 * @swagger
 * /api/timesheets/{id}/approve:
 *   post:
 *     tags:
 *       - Timesheet Approval
 *     summary: Approve timesheet
 *     description: Manager action to approve a submitted timesheet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Timesheet approved
 */
router.post("/:id/approve", ...approversOnly, approveTimesheet);

/**
 * @swagger
 * /api/timesheets/{id}/reject:
 *   post:
 *     tags:
 *       - Timesheet Approval
 *     summary: Reject timesheet
 *     description: Manager action to reject with feedback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Timesheet rejected
 */
router.post("/:id/reject", ...approversOnly, rejectTimesheet);

/* ═════════════════════════════════════════════════════════ */
/* TAG: TIMESHEET MANAGEMENT — PUT / PATCH                    */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/timesheets/entries/{id}:
 *   put:
 *     tags:
 *       - Timesheet Management
 *     summary: Update a timesheet entry
 *     description: Allows a clinician to edit hours/notes for a specific entry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TimesheetEntryUpdate'
 *     responses:
 *       200:
 *         description: Entry updated
 */
router.put("/entries/:id", ...clinicianOnly, updateTimesheetEntry);

/**
 * @swagger
 * /api/timesheets/admin/{id}/review:
 *   patch:
 *     tags:
 *       - Timesheet Administration
 *     summary: Final administrative review
 *     description: Specific endpoint for admin final review and sign-off
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Admin review completed
 */
router.patch("/admin/:id/review", ...approversOnly, adminApproveTimesheet);

export default router;
