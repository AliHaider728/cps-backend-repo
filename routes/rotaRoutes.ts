/**
 * routes/rotaRoutes.js — Rota & Schedule Management
 *
 * Mount in server.js: app.use("/api/rota", rotaRoutes);
 *
 * Endpoints organized: GET → POST → PATCH → DELETE (by resource group)
 * Full Swagger annotations included for all routes
 *
 * Manages monthly rotas, shifts, timesheets, and cover assignments
 */

import { Router, Request, Response, NextFunction } from "express";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { verifyToken } from "../middleware/auth.js";
import {
  allowRoles,
  allowClinicianSelfOrRoles,
  blockClinicianOnRota,
} from "../middleware/roleCheck.js";
import {
  getMonthlyRota,
  getClinicianRota,
  getMyRota,
  getRotaById,
  generateMonthlyRotaFromPatterns,
  createBulkShifts,
  createShift,
  updateShift,
  deleteShift,
  getRotaGaps,
  assignCover,
  sendRotaToClient,
  sendRotaToClients,
  getCoverRequests,
  getTimesheetForMonth,
  upsertTimesheetEntryForShift,
  updateTimesheetEntry,
  submitTimesheet,
  getPendingTimesheets,
  getTimesheetDetail,
  getClinicianTimesheetForAdmin,
  approveTimesheet,
  rejectTimesheet,
  checkRestrictedClinicianEntry,
  checkMandatoryComplianceEntry,
  seedShiftsFromJson,
} from "../controllers/rotaController.js";

const router: Router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const rotaReaders = [
  verifyToken,
  allowRoles("super_admin", "ops_manager", "workforce", "director", "finance", "training"),
];

const gapReaders = [
  verifyToken,
  allowRoles("super_admin", "ops_manager", "workforce", "director"),
];

const generator = [verifyToken, allowRoles("super_admin", "ops_manager")];

const writer = [
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "ops_manager"),
];

const rotaEntryWriter = [
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "ops_manager", "workforce", "director"),
];

const coverWriter = [
  verifyToken,
  blockClinicianOnRota,
  allowRoles("super_admin", "ops_manager", "workforce"),
];

const clinicianOnly = [verifyToken, allowRoles("clinician")];

const adminTimesheets = [
  verifyToken,
  allowRoles("super_admin", "ops_manager", "finance"),
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: ROTA MANAGEMENT — GET                                 */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/rota:
 *   get:
 *     tags:
 *       - Rota Management
 *     summary: Get monthly rota
 *     description: Retrieve rota for a specific month with all shifts and assignments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         required: true
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: departmentId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Monthly rota retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 month:
 *                   type: integer
 *                 year:
 *                   type: integer
 *                 shifts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Shift'
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalShifts:
 *                       type: integer
 *                     filledShifts:
 *                       type: integer
 *                     gapShifts:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/", ...rotaReaders, getMonthlyRota);

/**
 * @swagger
 * /api/rota/gaps:
 *   get:
 *     tags:
 *       - Rota Management
 *     summary: Get rota gaps
 *     description: Retrieve all unfilled shifts (gaps) requiring cover assignment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [urgent, high, medium, low]
 *     responses:
 *       200:
 *         description: Rota gaps retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RotaGap'
 *       401:
 *         description: Unauthorized
 */
router.get("/gaps", ...gapReaders, getRotaGaps);

/**
 * @swagger
 * /api/rota/my:
 *   get:
 *     tags:
 *       - My Rota
 *     summary: Get my rota
 *     description: Retrieve current clinician's personal rota for the month
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clinician's rota retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Shift'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions (clinician only)
 */
router.get("/my", ...clinicianOnly, getMyRota);

/**
 * @swagger
 * /api/rota/clinician/{id}:
 *   get:
 *     tags:
 *       - Rota Management
 *     summary: Get clinician rota
 *     description: Retrieve rota for a specific clinician (self or admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clinician rota retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Shift'
 *       404:
 *         description: Clinician not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/clinician/:id",
  verifyToken,
  allowClinicianSelfOrRoles(
    "id",
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training",
    "workforce"
  ),
  getClinicianRota
);

/**
 * @swagger
 * /api/rota/shift/{id}:
 *   get:
 *     tags:
 *       - Shift Management
 *     summary: Get shift by ID
 *     description: Retrieve details of a specific shift
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Shift retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Shift'
 *       404:
 *         description: Shift not found
 *       401:
 *         description: Unauthorized
 */
router.get("/shift/:id", ...rotaReaders, getRotaById);

/**
 * @swagger
 * /api/rota/cover-requests:
 *   get:
 *     tags:
 *       - Cover Management
 *     summary: Get cover requests
 *     description: Retrieve all pending cover requests
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, assigned, filled]
 *     responses:
 *       200:
 *         description: Cover requests retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/CoverRequest'
 *       401:
 *         description: Unauthorized
 */
router.get("/cover-requests", ...rotaReaders, getCoverRequests);

/**
 * @swagger
 * /api/rota/checks/restricted:
 *   get:
 *     tags:
 *       - Compliance Checks
 *     summary: Check restricted clinician entries
 *     description: Verify clinician restrictions and blocked assignments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clinicianId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: clientId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Restriction check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isRestricted:
 *                   type: boolean
 *                 restrictions:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/checks/restricted",
  verifyToken,
  blockClinicianOnRota,
  allowRoles(
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training",
    "workforce"
  ),
  checkRestrictedClinicianEntry
);

/**
 * @swagger
 * /api/rota/checks/compliance:
 *   get:
 *     tags:
 *       - Compliance Checks
 *     summary: Check mandatory compliance
 *     description: Verify clinician has all mandatory compliance documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clinicianId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Compliance check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 isCompliant:
 *                   type: boolean
 *                 missingDocuments:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/checks/compliance",
  verifyToken,
  blockClinicianOnRota,
  allowRoles(
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training",
    "workforce"
  ),
  checkMandatoryComplianceEntry
);

/**
 * @swagger
 * /api/rota/seed-data:
 *   get:
 *     tags:
 *       - Seed Data
 *     summary: Get seed data
 *     description: Retrieve sample shift data for testing and setup
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Seed data loaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                 message:
 *                   type: string
 *       500:
 *         description: Failed to load seed data
 */
router.get("/seed-data", ...generator, async (req: Request, res: Response) => {
  try {
    const seedDataPath = join(__dirname, "../seed-data/shifts.json");
    const seedData = await readFile(seedDataPath, "utf8");
    return res.status(200).json({
      data: JSON.parse(seedData),
      message: "Seed data loaded successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load seed data" });
  }
});

/**
 * @swagger
 * /api/rota/timesheet/my:
 *   get:
 *     tags:
 *       - Timesheet Management
 *     summary: Get my timesheet
 *     description: Retrieve current clinician's timesheet for a specific month
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Timesheet retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Timesheet'
 *       401:
 *         description: Unauthorized
 */
router.get("/timesheet/my", ...clinicianOnly, getTimesheetForMonth);

/**
 * @swagger
 * /api/rota/timesheets/pending:
 *   get:
 *     tags:
 *       - Timesheet Approval
 *     summary: Get pending timesheets
 *     description: Retrieve all pending timesheet approvals
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
 *     responses:
 *       200:
 *         description: Pending timesheets retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Timesheet'
 *       401:
 *         description: Unauthorized
 */
router.get("/timesheets/pending", ...adminTimesheets, getPendingTimesheets);

/**
 * @swagger
 * /api/rota/timesheets/clinician/{clinicianId}:
 *   get:
 *     tags:
 *       - Timesheet Approval
 *     summary: Get clinician timesheet (admin)
 *     description: Retrieve timesheet for specific clinician (admin view)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicianId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Clinician timesheet retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Timesheet'
 *       404:
 *         description: Clinician not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/timesheets/clinician/:clinicianId",
  ...adminTimesheets,
  getClinicianTimesheetForAdmin
);

/**
 * @swagger
 * /api/rota/timesheets/{id}/detail:
 *   get:
 *     tags:
 *       - Timesheet Approval
 *     summary: Get timesheet detail
 *     description: Retrieve detailed timesheet with all entries
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Timesheet detail retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TimesheetDetail'
 *       404:
 *         description: Timesheet not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/timesheets/:id/detail",
  ...adminTimesheets,
  getTimesheetDetail
);

/* ═════════════════════════════════════════════════════════ */
/* TAG: ROTA MANAGEMENT — POST                                */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/rota/generate:
 *   post:
 *     tags:
 *       - Rota Management
 *     summary: Generate monthly rota from patterns
 *     description: Auto-generate rota for a month based on clinician patterns and availability
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - month
 *               - year
 *             properties:
 *               month:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 12
 *               year:
 *                 type: integer
 *               clientIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               overwrite:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       201:
 *         description: Rota generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 shiftsCreated:
 *                   type: integer
 *                 gaps:
 *                   type: integer
 *       400:
 *         description: Invalid month/year or patterns incomplete
 *       403:
 *         description: Insufficient permissions
 */
router.post("/generate", ...generator, generateMonthlyRotaFromPatterns);

/**
 * @swagger
 * /api/rota/bulk:
 *   post:
 *     tags:
 *       - Shift Management
 *     summary: Create bulk shifts
 *     description: Create multiple shifts at once
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shifts
 *             properties:
 *               shifts:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ShiftInput'
 *     responses:
 *       201:
 *         description: Shifts created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 created:
 *                   type: integer
 *                 failed:
 *                   type: integer
 *       400:
 *         description: Invalid shift data
 *       403:
 *         description: Insufficient permissions
 */
router.post("/bulk", ...rotaEntryWriter, createBulkShifts);

/**
 * @swagger
 * /api/rota/shift:
 *   post:
 *     tags:
 *       - Shift Management
 *     summary: Create shift
 *     description: Create a single shift
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShiftInput'
 *     responses:
 *       201:
 *         description: Shift created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Shift'
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Insufficient permissions
 */
router.post("/shift", ...writer, createShift);

/**
 * @swagger
 * /api/rota/cover:
 *   post:
 *     tags:
 *       - Cover Management
 *     summary: Assign cover
 *     description: Assign clinician to cover a gap shift
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - shiftId
 *               - clinicianId
 *             properties:
 *               shiftId:
 *                 type: string
 *                 format: uuid
 *               clinicianId:
 *                 type: string
 *                 format: uuid
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cover assigned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Shift'
 *       400:
 *         description: Clinician unavailable or restricted
 *       404:
 *         description: Shift not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/cover", ...coverWriter, assignCover);

/**
 * @swagger
 * /api/rota/send-to-clients:
 *   post:
 *     tags:
 *       - Rota Distribution
 *     summary: Send rota to all clients
 *     description: Distribute rota to all clients via email/notification
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - month
 *               - year
 *             properties:
 *               month:
 *                 type: integer
 *               year:
 *                 type: integer
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rota sent to clients
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clientsSent:
 *                   type: integer
 *       400:
 *         description: Invalid month/year
 *       403:
 *         description: Insufficient permissions
 */
router.post("/send-to-clients", ...generator, sendRotaToClients);

/**
 * @swagger
 * /api/rota/send/{clientId}:
 *   post:
 *     tags:
 *       - Rota Distribution
 *     summary: Send rota to client
 *     description: Distribute rota to specific client
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - month
 *               - year
 *             properties:
 *               month:
 *                 type: integer
 *               year:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Rota sent to client
 *       404:
 *         description: Client not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/send/:clientId", ...generator, sendRotaToClient);

/**
 * @swagger
 * /api/rota/seed-shifts:
 *   post:
 *     tags:
 *       - Seed Data
 *     summary: Seed shifts from JSON
 *     description: Populate system with sample shifts from JSON file
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Shifts seeded
 *       500:
 *         description: Seed operation failed
 *       403:
 *         description: Insufficient permissions (super_admin only)
 */
router.post("/seed-shifts", verifyToken, allowRoles("super_admin"), seedShiftsFromJson);

/**
 * @swagger
 * /api/rota/timesheet/shift/{shiftId}:
 *   put:
 *     tags:
 *       - Timesheet Management
 *     summary: Upsert timesheet entry for shift
 *     description: Create or update timesheet entry for a specific shift
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: shiftId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actualHours:
 *                 type: number
 *               notes:
 *                 type: string
 *               overtimeHours:
 *                 type: number
 *     responses:
 *       200:
 *         description: Timesheet entry updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Shift not found
 *       401:
 *         description: Unauthorized
 */
router.put("/timesheet/shift/:shiftId", ...clinicianOnly, upsertTimesheetEntryForShift);

/**
 * @swagger
 * /api/rota/timesheet/entry/{id}:
 *   put:
 *     tags:
 *       - Timesheet Management
 *     summary: Update timesheet entry
 *     description: Update an existing timesheet entry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               actualHours:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Timesheet entry updated
 *       404:
 *         description: Entry not found
 *       401:
 *         description: Unauthorized
 */
router.put("/timesheet/entry/:id", ...clinicianOnly, updateTimesheetEntry);

/* ═════════════════════════════════════════════════════════ */
/* TAG: SHIFT MANAGEMENT — PATCH                              */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/rota/shift/{id}:
 *   patch:
 *     tags:
 *       - Shift Management
 *     summary: Update shift
 *     description: Update shift details, assignment, or status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clinicianId:
 *                 type: string
 *                 format: uuid
 *               startTime:
 *                 type: string
 *                 format: time
 *               endTime:
 *                 type: string
 *                 format: time
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shift updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Shift'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Shift not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch("/shift/:id", ...writer, updateShift);

/**
 * @swagger
 * /api/rota/timesheets/{id}/approve:
 *   post:
 *     tags:
 *       - Timesheet Approval
 *     summary: Approve timesheet
 *     description: Approve a submitted timesheet
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               approverNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Timesheet approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Timesheet'
 *       404:
 *         description: Timesheet not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/timesheets/:id/approve", ...generator, approveTimesheet);

/**
 * @swagger
 * /api/rota/timesheets/{id}/reject:
 *   post:
 *     tags:
 *       - Timesheet Approval
 *     summary: Reject timesheet
 *     description: Reject a submitted timesheet with feedback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Timesheet rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Timesheet'
 *       404:
 *         description: Timesheet not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/timesheets/:id/reject", ...generator, rejectTimesheet);

/**
 * @swagger
 * /api/rota/timesheet/{id}/submit:
 *   post:
 *     tags:
 *       - Timesheet Management
 *     summary: Submit timesheet
 *     description: Submit completed timesheet for approval
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               comment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Timesheet submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Timesheet'
 *       400:
 *         description: Incomplete timesheet data
 *       404:
 *         description: Timesheet not found
 *       401:
 *         description: Unauthorized
 */
router.post("/timesheet/:id/submit", ...clinicianOnly, submitTimesheet);

/* ═════════════════════════════════════════════════════════ */
/* TAG: SHIFT MANAGEMENT — DELETE                             */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/rota/shift/{id}:
 *   delete:
 *     tags:
 *       - Shift Management
 *     summary: Delete shift
 *     description: Permanently delete a shift
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Shift deleted
 *       404:
 *         description: Shift not found
 *       403:
 *         description: Insufficient permissions (generator only)
 *       409:
 *         description: Cannot delete - shift is locked or past
 */
router.delete("/shift/:id", ...generator, deleteShift);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;