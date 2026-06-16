/**
 * routes/clinicianRoutes.js — Module 3 (Clinician Management)
 *
 * Mounted at /api/clinicians by server.js.
 *
 * Endpoints organized: GET → POST → PUT → PATCH → DELETE (by resource group)
 * Swagger annotations included for all routes
 *
 * UPDATED:
 *   + GET  /:id/compliance-groups        — fetch assigned compliance groups with doc status
 *   + PUT  /:id/compliance-groups        — assign compliance groups to clinician
 *   + PUT  /:id/project-mappings/:mappingId — edit existing project mapping
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import { upload } from "../middleware/upload.js";

import {
  getClinicians,
  createClinician,
  getClinicianById,
  updateClinician,
  linkClinicianUser,
  deleteClinician,
  getClientHistory,
  addClientHistory,
  updateClientHistory,
  updateSystemAccess,
  restrictClinician,
  unrestrictClinician,
  updateClinicianUserLogin,
  resetClinicianUserPassword,
} from "../controllers/clinicianController.js";

import {
  getCompliance,
  upsertDoc,
  approveDoc,
  rejectDoc,
  getClinicianComplianceGroups,
  assignComplianceGroups,
} from "../controllers/clinicianComplianceController.js";

import {
  getLeave,
  getMyLeave,
  addLeave,
  updateLeave,
  deleteLeave,
} from "../controllers/leaveController.js";

import {
  getProjectMappings,
  createProjectMapping,
  updateProjectMapping,
  deleteProjectMapping,
} from "../controllers/projectMappingController.js";

import {
  getLogs as getSupervisionLogs,
  addLog as addSupervisionLog,
  updateLog as updateSupervisionLog,
  deleteLog as deleteSupervisionLog,
} from "../controllers/supervisionController.js";

import { getCPPE, updateCPPE } from "../controllers/cppeController.js";
import { updateOnboarding, sendWelcomePack } from "../controllers/onboardingController.js";

const router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const reader = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance", "training_manager", "workforce_manager"),
];

const writer = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];

const admin = [verifyToken, allowRoles("super_admin", "ops_manager")];

const clinicianSelf = [verifyToken, allowRoles("clinician", "super_admin")];

const leaveReader = [
  verifyToken,
  allowRoles(
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training_manager",
    "workforce_manager",
    "clinician"
  ),
];

const clinicianLeaveWriter = [
  verifyToken,
  allowRoles("clinician", "super_admin", "director", "ops_manager"),
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: CLINICIAN CRUD                                       */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/clinicians:
 *   get:
 *     tags:
 *       - Clinician CRUD
 *     summary: List all clinicians
 *     description: Retrieve paginated list of all clinicians with basic info
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
 *         name: search
 *         schema:
 *           type: string
 *           description: Search by name or email
 *     responses:
 *       200:
 *         description: List of clinicians retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Clinician'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/", ...reader, getClinicians);

/**
 * @swagger
 * /api/clinicians/{id}:
 *   get:
 *     tags:
 *       - Clinician CRUD
 *     summary: Get clinician by ID
 *     description: Retrieve complete clinician profile with all associated data
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
 *         description: Clinician profile retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClinicianDetail'
 *       404:
 *         description: Clinician not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id", ...reader, getClinicianById);

/**
 * @swagger
 * /api/clinicians/me/leave:
 *   get:
 *     tags:
 *       - Leave Management
 *     summary: Get current clinician's leave records
 *     description: Retrieve leave history for logged-in clinician (self)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Leave records retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LeaveRecord'
 *       401:
 *         description: Unauthorized
 */
router.get("/me/leave", ...clinicianSelf, getMyLeave);

/**
 * @swagger
 * /api/clinicians/{id}/compliance:
 *   get:
 *     tags:
 *       - Compliance Management
 *     summary: Get clinician compliance documents
 *     description: Retrieve all compliance documents for a clinician with approval status
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *     responses:
 *       200:
 *         description: Compliance documents retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ComplianceDoc'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/compliance", ...leaveReader, getCompliance);

/**
 * @swagger
 * /api/clinicians/{id}/compliance-groups:
 *   get:
 *     tags:
 *       - Compliance Management
 *     summary: Get clinician compliance groups
 *     description: Fetch assigned compliance groups and documentation status for clinician
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
 *         description: Compliance groups retrieved with doc status
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ComplianceGroup'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/compliance-groups", ...leaveReader, getClinicianComplianceGroups);

/**
 * @swagger
 * /api/clinicians/{id}/client-history:
 *   get:
 *     tags:
 *       - Client History
 *     summary: Get clinician client history
 *     description: Retrieve all client interactions and history records for clinician
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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: Client history retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ClientHistory'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/client-history", ...reader, getClientHistory);

/**
 * @swagger
 * /api/clinicians/{id}/leave:
 *   get:
 *     tags:
 *       - Leave Management
 *     summary: Get clinician leave records
 *     description: Retrieve leave history and pending requests for specific clinician
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *     responses:
 *       200:
 *         description: Leave records retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/LeaveRecord'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/leave", ...leaveReader, getLeave);

/**
 * @swagger
 * /api/clinicians/{id}/project-mappings:
 *   get:
 *     tags:
 *       - Project Mapping
 *     summary: Get clinician project mappings
 *     description: Retrieve all project assignments and finance mappings for clinician
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
 *         description: Project mappings retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ProjectMapping'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/project-mappings", ...reader, getProjectMappings);

/**
 * @swagger
 * /api/clinicians/{id}/supervision:
 *   get:
 *     tags:
 *       - Supervision
 *     summary: Get supervision logs
 *     description: Retrieve supervision session logs and notes for clinician
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
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Supervision logs retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/SupervisionLog'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/supervision", ...leaveReader, getSupervisionLogs);

/**
 * @swagger
 * /api/clinicians/{id}/cppe:
 *   get:
 *     tags:
 *       - CPPE Management
 *     summary: Get CPPE records
 *     description: Retrieve Continuing Professional Practice Education records
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
 *         description: CPPE records retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CPPE'
 *       404:
 *         description: Clinician not found
 */
router.get("/:id/cppe", ...leaveReader, getCPPE);

/* ═════════════════════════════════════════════════════════ */
/* TAG: CLINICIAN CREATE                                     */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/clinicians:
 *   post:
 *     tags:
 *       - Clinician CRUD
 *     summary: Create new clinician
 *     description: Create a new clinician record with basic profile information
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - role
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [clinician, senior_clinician, team_lead]
 *               department:
 *                 type: string
 *               qualifications:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Clinician created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Clinician'
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Insufficient permissions
 */
router.post("/", ...writer, createClinician);

/**
 * @swagger
 * /api/clinicians/{id}/client-history:
 *   post:
 *     tags:
 *       - Client History
 *     summary: Add client history record
 *     description: Create a new client interaction or encounter record
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
 *               - clientName
 *               - date
 *               - type
 *             properties:
 *               clientName:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               type:
 *                 type: string
 *                 enum: [consultation, follow_up, assessment]
 *               notes:
 *                 type: string
 *               outcome:
 *                 type: string
 *     responses:
 *       201:
 *         description: Client history record created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientHistory'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 */
router.post("/:id/client-history", ...writer, addClientHistory);

/**
 * @swagger
 * /api/clinicians/{id}/leave:
 *   post:
 *     tags:
 *       - Leave Management
 *     summary: Create leave request
 *     description: Submit a new leave request for a clinician
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
 *               - startDate
 *               - endDate
 *               - type
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               type:
 *                 type: string
 *                 enum: [annual, sick, unpaid, sabbatical]
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Leave request created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LeaveRecord'
 *       400:
 *         description: Invalid dates or overlapping leave
 *       404:
 *         description: Clinician not found
 */
router.post("/:id/leave", ...clinicianLeaveWriter, addLeave);

/**
 * @swagger
 * /api/clinicians/{id}/project-mappings:
 *   post:
 *     tags:
 *       - Project Mapping
 *     summary: Create project mapping
 *     description: Assign a clinician to a project for finance tracking
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
 *               - projectId
 *               - allocationPercentage
 *             properties:
 *               projectId:
 *                 type: string
 *                 format: uuid
 *               allocationPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               billableRate:
 *                 type: number
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Project mapping created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectMapping'
 *       400:
 *         description: Invalid allocation or project not found
 *       404:
 *         description: Clinician not found
 */
router.post("/:id/project-mappings", ...writer, createProjectMapping);

/**
 * @swagger
 * /api/clinicians/{id}/supervision:
 *   post:
 *     tags:
 *       - Supervision
 *     summary: Create supervision log
 *     description: Record a supervision session with notes and observations
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
 *               - date
 *               - supervisor
 *             properties:
 *               date:
 *                 type: string
 *                 format: date-time
 *               supervisor:
 *                 type: string
 *               duration:
 *                 type: integer
 *                 description: Duration in minutes
 *               notes:
 *                 type: string
 *               topics:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Supervision log created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SupervisionLog'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 */
router.post("/:id/supervision", ...writer, addSupervisionLog);

/**
 * @swagger
 * /api/clinicians/{id}/compliance/{docId}/approve:
 *   post:
 *     tags:
 *       - Compliance Management
 *     summary: Approve compliance document
 *     description: Approve a submitted compliance document
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: docId
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
 *               approvedNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDoc'
 *       404:
 *         description: Document or clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/:id/compliance/:docId/approve", ...admin, approveDoc);

/**
 * @swagger
 * /api/clinicians/{id}/compliance/{docId}/reject:
 *   post:
 *     tags:
 *       - Compliance Management
 *     summary: Reject compliance document
 *     description: Reject a submitted compliance document with feedback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: docId
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
 *               - rejectionReason
 *             properties:
 *               rejectionReason:
 *                 type: string
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDoc'
 *       400:
 *         description: Rejection reason required
 *       404:
 *         description: Document or clinician not found
 */
router.post("/:id/compliance/:docId/reject", ...admin, rejectDoc);

/**
 * @swagger
 * /api/clinicians/{id}/onboarding/welcome:
 *   post:
 *     tags:
 *       - Onboarding
 *     summary: Send welcome pack
 *     description: Send welcome pack and onboarding materials to clinician
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
 *         description: Welcome pack sent
 *       400:
 *         description: Unable to send welcome pack
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/:id/onboarding/welcome", ...admin, sendWelcomePack);

/* ═════════════════════════════════════════════════════════ */
/* TAG: CLINICIAN UPDATE (PUT)                               */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/clinicians/{id}:
 *   put:
 *     tags:
 *       - Clinician CRUD
 *     summary: Update clinician profile
 *     description: Update clinician's basic information and profile details
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
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [clinician, senior_clinician, team_lead]
 *               department:
 *                 type: string
 *               qualifications:
 *                 type: array
 *                 items:
 *                   type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive, on_leave]
 *     responses:
 *       200:
 *         description: Clinician updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Clinician'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.put("/:id", ...writer, updateClinician);

/**
 * @swagger
 * /api/clinicians/{id}/client-history/{recordId}:
 *   put:
 *     tags:
 *       - Client History
 *     summary: Update client history record
 *     description: Update existing client interaction record with new information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: recordId
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
 *               clientName:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *               outcome:
 *                 type: string
 *     responses:
 *       200:
 *         description: Client history record updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientHistory'
 *       404:
 *         description: Record or clinician not found
 */
router.put("/:id/client-history/:recordId", ...writer, updateClientHistory);

/**
 * @swagger
 * /api/clinicians/{id}/leave/{entryId}:
 *   put:
 *     tags:
 *       - Leave Management
 *     summary: Update leave record
 *     description: Modify existing leave request details or status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: entryId
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
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               type:
 *                 type: string
 *                 enum: [annual, sick, unpaid, sabbatical]
 *               status:
 *                 type: string
 *                 enum: [pending, approved, rejected]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Leave record updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LeaveRecord'
 *       400:
 *         description: Invalid dates
 *       404:
 *         description: Leave entry or clinician not found
 */
router.put("/:id/leave/:entryId", ...writer, updateLeave);

/**
 * @swagger
 * /api/clinicians/{id}/project-mappings/{mappingId}:
 *   put:
 *     tags:
 *       - Project Mapping
 *     summary: Update project mapping
 *     description: Edit existing project allocation and finance mapping
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: mappingId
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
 *               allocationPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               billableRate:
 *                 type: number
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [active, inactive, archived]
 *     responses:
 *       200:
 *         description: Project mapping updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProjectMapping'
 *       400:
 *         description: Invalid allocation percentage
 *       404:
 *         description: Mapping or clinician not found
 */
router.put("/:id/project-mappings/:mappingId", ...writer, updateProjectMapping);

/**
 * @swagger
 * /api/clinicians/{id}/supervision/{logId}:
 *   put:
 *     tags:
 *       - Supervision
 *     summary: Update supervision log
 *     description: Modify existing supervision session record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: logId
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
 *               date:
 *                 type: string
 *                 format: date-time
 *               duration:
 *                 type: integer
 *               notes:
 *                 type: string
 *               topics:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Supervision log updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SupervisionLog'
 *       404:
 *         description: Log or clinician not found
 */
router.put("/:id/supervision/:logId", ...clinicianLeaveWriter, updateSupervisionLog);

/**
 * @swagger
 * /api/clinicians/{id}/compliance/{docId}:
 *   patch:
 *     tags:
 *       - Compliance Management
 *     summary: Upload/update compliance document
 *     description: Upload or update a compliance document with file attachment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: docId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Compliance document uploaded/updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDoc'
 *       400:
 *         description: No file provided or invalid format
 *       404:
 *         description: Document or clinician not found
 */
router.patch("/:id/compliance/:docId", ...writer, upload.single("file"), upsertDoc);

/**
 * @swagger
 * /api/clinicians/{id}/compliance-groups:
 *   put:
 *     tags:
 *       - Compliance Management
 *     summary: Assign compliance groups
 *     description: Assign one or more compliance groups to a clinician
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
 *               - groupIds
 *             properties:
 *               groupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Compliance groups assigned
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ComplianceGroup'
 *       400:
 *         description: Invalid group IDs
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.put("/:id/compliance-groups", ...admin, assignComplianceGroups);

/**
 * @swagger
 * /api/clinicians/{id}/cppe:
 *   put:
 *     tags:
 *       - CPPE Management
 *     summary: Update CPPE records
 *     description: Update Continuing Professional Practice Education records
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
 *               hoursCompleted:
 *                 type: integer
 *               targetHours:
 *                 type: integer
 *               courses:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                     provider:
 *                       type: string
 *                     hoursEarned:
 *                       type: integer
 *                     completionDate:
 *                       type: string
 *                       format: date
 *     responses:
 *       200:
 *         description: CPPE records updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CPPE'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 */
router.put("/:id/cppe", ...writer, updateCPPE);

/**
 * @swagger
 * /api/clinicians/{id}/onboarding:
 *   put:
 *     tags:
 *       - Onboarding
 *     summary: Update onboarding status
 *     description: Update clinician onboarding progress and completion status
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
 *               stage:
 *                 type: string
 *                 enum: [not_started, in_progress, completed]
 *               induction:
 *                 type: boolean
 *               training:
 *                 type: boolean
 *               documentation:
 *                 type: boolean
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Onboarding status updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 */
router.put("/:id/onboarding", ...writer, updateOnboarding);

/* ═════════════════════════════════════════════════════════ */
/* TAG: CLINICIAN PATCH (SPECIAL OPERATIONS)                 */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/clinicians/{id}/link-user:
 *   patch:
 *     tags:
 *       - Clinician CRUD
 *     summary: Link user to clinician
 *     description: Associate a user account with a clinician record
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
 *               - userId
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: User linked to clinician
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Clinician'
 *       400:
 *         description: Invalid user ID
 *       404:
 *         description: Clinician or user not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch("/:id/link-user", ...admin, linkClinicianUser);

/**
 * @swagger
 * /api/clinicians/{id}/user-login:
 *   patch:
 *     tags:
 *       - Clinician CRUD
 *     summary: Update clinician user login
 *     description: Update login credentials and user authentication settings
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
 *               email:
 *                 type: string
 *                 format: email
 *               username:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [active, inactive, locked]
 *     responses:
 *       200:
 *         description: User login updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 */
router.patch("/:id/user-login", ...admin, updateClinicianUserLogin);

/**
 * @swagger
 * /api/clinicians/{id}/client-history/{recordId}/system-access:
 *   patch:
 *     tags:
 *       - Client History
 *     summary: Update system access for client record
 *     description: Modify system access permissions or status for a client history record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: recordId
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
 *               accessLevel:
 *                 type: string
 *                 enum: [none, read, write, admin]
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: System access updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClientHistory'
 *       404:
 *         description: Record or clinician not found
 */
router.patch("/:id/client-history/:recordId/system-access", ...writer, updateSystemAccess);

/**
 * @swagger
 * /api/clinicians/{id}/restrict:
 *   patch:
 *     tags:
 *       - Clinician CRUD
 *     summary: Restrict clinician access
 *     description: Globally restrict a clinician's system access (compliance or disciplinary)
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
 *               reason:
 *                 type: string
 *               duration:
 *                 type: integer
 *                 description: Duration in days (0 for indefinite)
 *     responses:
 *       200:
 *         description: Clinician access restricted
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch("/:id/restrict", ...admin, restrictClinician);

/**
 * @swagger
 * /api/clinicians/{id}/unrestrict:
 *   patch:
 *     tags:
 *       - Clinician CRUD
 *     summary: Unrestrict clinician access
 *     description: Remove access restrictions and restore clinician's system access
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
 *         description: Clinician access unrestricted
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.patch("/:id/unrestrict", ...admin, unrestrictClinician);

/* ═════════════════════════════════════════════════════════ */
/* TAG: CLINICIAN DELETE                                     */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/clinicians/{id}:
 *   delete:
 *     tags:
 *       - Clinician CRUD
 *     summary: Delete clinician
 *     description: Permanently delete a clinician record and associated data
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
 *         description: Clinician deleted
 *       404:
 *         description: Clinician not found
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: Cannot delete - clinician has active assignments
 */
router.delete("/:id", ...admin, deleteClinician);

/**
 * @swagger
 * /api/clinicians/{id}/leave/{entryId}:
 *   delete:
 *     tags:
 *       - Leave Management
 *     summary: Delete leave record
 *     description: Remove a leave record from the system
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Leave record deleted
 *       404:
 *         description: Leave entry or clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id/leave/:entryId", ...writer, deleteLeave);

/**
 * @swagger
 * /api/clinicians/{id}/project-mappings/{mappingId}:
 *   delete:
 *     tags:
 *       - Project Mapping
 *     summary: Delete project mapping
 *     description: Remove a project mapping and assignment from clinician
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: mappingId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Project mapping deleted
 *       404:
 *         description: Mapping or clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id/project-mappings/:mappingId", ...writer, deleteProjectMapping);

/**
 * @swagger
 * /api/clinicians/{id}/supervision/{logId}:
 *   delete:
 *     tags:
 *       - Supervision
 *     summary: Delete supervision log
 *     description: Remove a supervision session record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Supervision log deleted
 *       404:
 *         description: Log or clinician not found
 *       403:
 *         description: Insufficient permissions
 */
router.delete("/:id/supervision/:logId", ...admin, deleteSupervisionLog);

/**
 * @swagger
 * /api/clinicians/{id}/reset-login-password:
 *   post:
 *     tags:
 *       - Clinician CRUD
 *     summary: Reset clinician user password
 *     description: Reset login password for clinician user account
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
 *               tempPassword:
 *                 type: string
 *                 description: Optional temporary password to set
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Clinician or user not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/:id/reset-login-password", ...admin, resetClinicianUserPassword);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;