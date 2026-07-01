/**
 * routes/leaveAdminRoutes.js — Leave Management Administration
 *
 * Mount in server.js: app.use("/api/leave-admin", leaveAdminRoutes);
 *
 * Endpoints organized: GET → PATCH (by resource group)
 * Full Swagger annotations included for all routes
 *
 * Provides admin/manager interface for reviewing and managing leave requests
 */

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  listAdminLeaves,
  reviewLeave,
  getLeaveReport,
} from "../controllers/leaveAdminController.js";

const router: Router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const adminReader = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance"),
];

const adminWriter = [
  verifyToken,
  allowRoles("super_admin", "ops_manager", "director"),
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: LEAVE ADMINISTRATION — GET                            */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/leave-admin:
 *   get:
 *     tags:
 *       - Leave Administration
 *     summary: List leave requests for admin review
 *     description: Retrieve all leave requests with filters for status, clinician, period, and type
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
 *           enum: [pending, approved, rejected, cancelled, on_leave]
 *           description: Filter by leave request status
 *       - in: query
 *         name: leaveType
 *         schema:
 *           type: string
 *           enum: [annual, sick, unpaid, sabbatical, compassionate, study, other]
 *           description: Filter by type of leave
 *       - in: query
 *         name: clinicianId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by specific clinician
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Filter by department
 *       - in: query
 *         name: startDateFrom
 *         schema:
 *           type: string
 *           format: date
 *           description: Filter by start date range (from)
 *       - in: query
 *         name: startDateTo
 *         schema:
 *           type: string
 *           format: date
 *           description: Filter by start date range (to)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           description: Search by clinician name or email
 *     responses:
 *       200:
 *         description: Leave requests retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LeaveRequest'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 summary:
 *                   type: object
 *                   properties:
 *                     pending:
 *                       type: integer
 *                     approved:
 *                       type: integer
 *                     rejected:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/", ...adminReader, listAdminLeaves);

/**
 * @swagger
 * /api/leave-admin/report:
 *   get:
 *     tags:
 *       - Leave Administration
 *     summary: Get leave statistics and report
 *     description: Retrieve leave summary statistics by type, department, and period
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periodFrom
 *         schema:
 *           type: string
 *           format: date
 *           description: Report period start date
 *       - in: query
 *         name: periodTo
 *         schema:
 *           type: string
 *           format: date
 *           description: Report period end date
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [department, leaveType, status, clinician]
 *           default: leaveType
 *           description: Grouping dimension for report
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *           format: uuid
 *           description: Limit report to specific department
 *     responses:
 *       200:
 *         description: Leave statistics and report retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: object
 *                   properties:
 *                     from:
 *                       type: string
 *                       format: date
 *                     to:
 *                       type: string
 *                       format: date
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalRequests:
 *                       type: integer
 *                     totalDays:
 *                       type: number
 *                     byStatus:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                 byLeaveType:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       count:
 *                         type: integer
 *                       totalDays:
 *                         type: number
 *                 byDepartment:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       count:
 *                         type: integer
 *                       totalDays:
 *                         type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/report", ...adminReader, getLeaveReport);

/* ═════════════════════════════════════════════════════════ */
/* TAG: LEAVE ADMINISTRATION — PATCH                          */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/leave-admin/{id}/review:
 *   patch:
 *     tags:
 *       - Leave Administration
 *     summary: Review and approve/reject leave request
 *     description: Manager/admin reviews leave request and updates status (approve, reject, or cancel)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Leave request ID
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
 *                 enum: [approve, reject, cancel]
 *                 description: Action to take on leave request
 *               feedback:
 *                 type: string
 *                 description: Optional feedback or reason for rejection/cancellation
 *               approverNotes:
 *                 type: string
 *                 description: Internal notes for other managers
 *               adjustments:
 *                 type: object
 *                 description: Optional adjustments to approved dates
 *                 properties:
 *                   startDate:
 *                     type: string
 *                     format: date
 *                   endDate:
 *                     type: string
 *                     format: date
 *     responses:
 *       200:
 *         description: Leave request updated with new status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LeaveRequest'
 *       400:
 *         description: Invalid action or cannot update (already approved/rejected)
 *       404:
 *         description: Leave request not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (admin/director only)
 */
router.patch("/:id/review", ...adminWriter, reviewLeave);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;