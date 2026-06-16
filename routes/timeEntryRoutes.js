/**
 * routes/timeEntryRoutes.js — Time Tracking & Attendance
 *
 * Mount in server.js: app.use("/api/time-entries", timeEntryRoutes);
 *
 * Endpoints organized: GET → POST
 * Full Swagger annotations included for all routes
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  getActiveEntry,
  clockIn,
  clockOut,
  getTimeEntries,
  getAdminSummary,
  getClinicianTimeEntriesAdmin,
} from "../controllers/timeEntryController.js";

const router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const clinicianOnly = [verifyToken, allowRoles("clinician")];

const adminOnly = [
  verifyToken, 
  allowRoles("super_admin", "director", "ops_manager", "finance", "training", "workforce")
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: TIME ENTRY MANAGEMENT — GET                           */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/time-entries:
 *   get:
 *     tags:
 *       - Time Entry Management
 *     summary: Get clinician time entries
 *     description: Retrieve all personal time logs for the authenticated clinician
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Time entries retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/TimeEntry'
 *       401:
 *         description: Unauthorized
 */
router.get("/", ...clinicianOnly, getTimeEntries);

/**
 * @swagger
 * /api/time-entries/active:
 *   get:
 *     tags:
 *       - Time Entry Management
 *     summary: Get current active entry
 *     description: Check if the authenticated clinician currently has an active (running) clock-in session
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active entry found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TimeEntry'
 *       204:
 *         description: No active entry found
 *       401:
 *         description: Unauthorized
 */
router.get("/active", ...clinicianOnly, getActiveEntry);

/**
 * @swagger
 * /api/time-entries/admin/summary:
 *   get:
 *     tags:
 *       - Time Entry Management
 *     summary: Get admin attendance summary
 *     description: Retrieve a global summary of all time entries for admin reporting
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admin summary retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       403:
 *         description: Insufficient permissions
 */
router.get("/admin/summary", ...adminOnly, getAdminSummary);

/**
 * @swagger
 * /api/time-entries/admin/clinician/{clinicianId}:
 *   get:
 *     tags:
 *       - Time Entry Management
 *     summary: Get specific clinician entries (Admin)
 *     description: Retrieve all time entries for a specific clinician by their ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicianId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Clinician time entries retrieved
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.get("/admin/clinician/:clinicianId", ...adminOnly, getClinicianTimeEntriesAdmin);

/* ═════════════════════════════════════════════════════════ */
/* TAG: TIME ENTRY MANAGEMENT — POST                          */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/time-entries/clock-in:
 *   post:
 *     tags:
 *       - Time Entry Management
 *     summary: Start clock-in
 *     description: Start a new time entry session for the authenticated clinician
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Clock-in successful
 *       400:
 *         description: Clinician already clocked in
 */
router.post("/clock-in", ...clinicianOnly, clockIn);

/**
 * @swagger
 * /api/time-entries/clock-out:
 *   post:
 *     tags:
 *       - Time Entry Management
 *     summary: Stop clock-out
 *     description: End the current active session and calculate total hours
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Clock-out successful
 *       400:
 *         description: No active clock-in session found
 */
router.post("/clock-out", ...clinicianOnly, clockOut);

export default router;