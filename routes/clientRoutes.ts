import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import { upload }     from "../middleware/upload.js"; // KEEP for legacy compliance only

import {
  getReportingArchive as getReportingArchiveV2,
  addToReportingArchive as addToReportingArchiveV2,
  deleteFromReportingArchive as deleteFromReportingArchiveV2,
} from "../controllers/reportingArchiveController.js";

import {
  getHierarchy, searchClients,
  getICBs, getICBById, createICB, updateICB, deleteICB,
  getFederations, createFederation, updateFederation, deleteFederation,
  getPCNs, getPCNById, createPCN, updatePCN, deletePCN,
  updateRestrictedClinicians, getMonthlyMeetings, upsertMonthlyMeeting, getPCNRollup,
  getPractices, getPracticeById, createPractice, updatePractice, deletePractice,
  updatePracticeRestricted, requestSystemAccess,
  getContactHistory, addContactHistory, updateContactHistory,
  toggleStarred, deleteContactHistory,
  sendMassEmail, trackEmailOpen,

  // NEW
  getDecisionMakers,
  updateDecisionMakers,
  getFinanceContacts,
  updateFinanceContacts,
  getClientFacingData,
  updateClientFacingData,

  //   NEW — Rate & Contract History (Jun 2026)
  getPCNRateHistory,
  getAllPCNRateSummary,
} from "../controllers/clientController.js";

import {
  getComplianceStatus,
  upsertComplianceDoc,
  approveComplianceDoc,
  rejectComplianceDoc,
  getExpiringDocs,
  runExpiryCheck,
  getEntityDocuments,
  upsertEntityDocument,
  addEntityDocumentUploads,
  updateEntityDocumentUpload,
  deleteEntityDocumentUpload,
} from "../controllers/complianceController.js";

const router = Router();

const admin     = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const adminFin  = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance")];
const superOnly = [verifyToken, allowRoles("super_admin")];

/**
 * @swagger
 * tags:
 *   - name: Client - GET
 *     description: Read / fetch endpoints
 *   - name: Client - POST
 *     description: Create / action endpoints
 *   - name: Client - PUT
 *     description: Update endpoints
 *   - name: Client - PATCH
 *     description: Partial update endpoints
 *   - name: Client - DELETE
 *     description: Delete endpoints
 */

/* ===========================================================
 *  GET ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/clients/track/{trackingId}:
 *   get:
 *     summary: Track mass email open (public pixel endpoint)
 *     tags: [Client - GET]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: trackingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Tracking ID embedded in the email
 *     responses:
 *       200:
 *         description: Tracking recorded
 *       404:
 *         description: Tracking ID not found
 */
router.get("/track/:trackingId", trackEmailOpen);

/**
 * @swagger
 * /api/clients/hierarchy:
 *   get:
 *     summary: Get full client hierarchy (ICB > Federation > PCN > Practice)
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hierarchy data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/hierarchy", ...admin, getHierarchy);

/**
 * @swagger
 * /api/clients/search:
 *   get:
 *     summary: Search clients across the hierarchy
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/search", ...adminFin, searchClients);

/**
 * @swagger
 * /api/clients/icb:
 *   get:
 *     summary: Get all ICBs
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of ICBs
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/icb", ...adminFin, getICBs);

/**
 * @swagger
 * /api/clients/icb/{id}:
 *   get:
 *     summary: Get a single ICB by ID
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ICB ID
 *     responses:
 *       200:
 *         description: ICB data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: ICB not found
 */
router.get("/icb/:id", ...adminFin, getICBById);

/**
 * @swagger
 * /api/clients/federation:
 *   get:
 *     summary: Get all federations
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of federations
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/federation", ...adminFin, getFederations);

/**
 * @swagger
 * /api/clients/pcn:
 *   get:
 *     summary: Get all PCNs
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of PCNs
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/pcn", ...adminFin, getPCNs);

/**
 * @swagger
 * /api/clients/pcn/rate-history/summary:
 *   get:
 *     summary: Get rate and contract history summary for all active PCN clients
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Returns an array of all active PCNs, each with current hourlyRate,
 *       contract dates, last change entry, and total history count.
 *       Use this to power the PCN list page rate history column.
 *       This route must be declared before /pcn/:id so Express does not
 *       treat rate-history as an :id param value.
 *     responses:
 *       200:
 *         description: >
 *           Array of all active PCNs each with current hourlyRate,
 *           contract dates, last change entry, and total history count.
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/pcn/rate-history/summary", ...adminFin, getAllPCNRateSummary);

/**
 * @swagger
 * /api/clients/pcn/{id}:
 *   get:
 *     summary: Get a single PCN by ID
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: PCN data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.get("/pcn/:id", ...adminFin, getPCNById);

/**
 * @swagger
 * /api/clients/pcn/{id}/rollup:
 *   get:
 *     summary: Get PCN rollup data (aggregated practice stats)
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: PCN rollup data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.get("/pcn/:id/rollup", ...adminFin, getPCNRollup);

/**
 * @swagger
 * /api/clients/pcn/{id}/meetings:
 *   get:
 *     summary: Get monthly meetings for a PCN
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: List of monthly meetings
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.get("/pcn/:id/meetings", ...admin, getMonthlyMeetings);

/**
 * @swagger
 * /api/clients/pcn/{id}/client-facing:
 *   get:
 *     summary: Get client-facing data for a PCN
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: Client-facing data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.get("/pcn/:id/client-facing", ...adminFin, getClientFacingData);

/**
 * @swagger
 * /api/clients/pcn/{id}/rate-history:
 *   get:
 *     summary: Get full rate and contract date history for a single PCN client
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: >
 *           Returns entityName, current hourlyRate, contractType,
 *           contractStartDate, contractRenewalDate, contractExpiryDate,
 *           and history array of field changes with changedAt and changedBy.
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.get("/pcn/:id/rate-history", ...adminFin, getPCNRateHistory);

/**
 * @swagger
 * /api/clients/practice:
 *   get:
 *     summary: Get all practices
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of practices
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/practice", ...adminFin, getPractices);

/**
 * @swagger
 * /api/clients/practice/{id}:
 *   get:
 *     summary: Get a single practice by ID
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Practice ID
 *     responses:
 *       200:
 *         description: Practice data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Practice not found
 */
router.get("/practice/:id", ...adminFin, getPracticeById);

/**
 * @swagger
 * /api/clients/compliance/expiring:
 *   get:
 *     summary: Get documents expiring soon (static compliance)
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of expiring documents
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/compliance/expiring", ...adminFin, getExpiringDocs);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/reporting-archive:
 *   get:
 *     summary: Get reporting archive for an entity
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: List of reporting archive entries
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get(
  "/:entityType/:entityId/reporting-archive",
  ...adminFin,
  getReportingArchiveV2
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/decision-makers:
 *   get:
 *     summary: Get decision makers for an entity
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Decision makers data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get("/:entityType/:entityId/decision-makers", ...adminFin, getDecisionMakers);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/finance-contacts:
 *   get:
 *     summary: Get finance contacts for an entity
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Finance contacts data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get("/:entityType/:entityId/finance-contacts", ...adminFin, getFinanceContacts);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/documents:
 *   get:
 *     summary: Get entity documents
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: List of entity documents
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get(
  "/:entityType/:entityId/documents",
  ...adminFin,
  getEntityDocuments
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/compliance/status:
 *   get:
 *     summary: Get compliance status for an entity
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Compliance status data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get(
  "/:entityType/:entityId/compliance/status",
  ...adminFin,
  getComplianceStatus
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/history:
 *   get:
 *     summary: Get contact history for an entity
 *     tags: [Client - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: List of contact history entries
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.get("/:entityType/:entityId/history", ...adminFin, getContactHistory);


/* ===========================================================
 *  POST ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/clients/icb:
 *   post:
 *     summary: Create a new ICB
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: ICB payload
 *     responses:
 *       201:
 *         description: ICB created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/icb", ...admin, createICB);

/**
 * @swagger
 * /api/clients/federation:
 *   post:
 *     summary: Create a new federation
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Federation payload
 *     responses:
 *       201:
 *         description: Federation created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/federation", ...admin, createFederation);

/**
 * @swagger
 * /api/clients/pcn:
 *   post:
 *     summary: Create a new PCN
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: PCN payload
 *     responses:
 *       201:
 *         description: PCN created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/pcn", ...admin, createPCN);

/**
 * @swagger
 * /api/clients/pcn/{id}/meetings:
 *   post:
 *     summary: Create or update a monthly meeting record for a PCN
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Monthly meeting payload
 *     responses:
 *       200:
 *         description: Monthly meeting upserted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.post("/pcn/:id/meetings", ...admin, upsertMonthlyMeeting);

/**
 * @swagger
 * /api/clients/practice:
 *   post:
 *     summary: Create a new practice
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Practice payload
 *     responses:
 *       201:
 *         description: Practice created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/practice", ...admin, createPractice);

/**
 * @swagger
 * /api/clients/compliance/run-expiry:
 *   post:
 *     summary: Run the compliance expiry check job
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expiry check completed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/compliance/run-expiry", ...admin, runExpiryCheck);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/reporting-archive:
 *   post:
 *     summary: Add an entry to the reporting archive (JSON only)
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - month
 *               - year
 *               - reportUrl
 *               - fileName
 *             properties:
 *               month:
 *                 type: integer
 *               year:
 *                 type: integer
 *               reportUrl:
 *                 type: string
 *               fileName:
 *                 type: string
 *               notes:
 *                 type: string
 *               starred:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Reporting archive entry added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.post(
  "/:entityType/:entityId/reporting-archive",
  ...admin,
  addToReportingArchiveV2
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/documents/{groupId}/{documentId}/uploads:
 *   post:
 *     summary: Add uploads to an entity document group (JSON only)
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document group ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               uploads:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Uploads added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity or document not found
 */
router.post(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads",
  ...admin,
  addEntityDocumentUploads
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/compliance/{docKey}/approve:
 *   post:
 *     summary: Approve a compliance document
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: docKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Compliance document key
 *     responses:
 *       200:
 *         description: Document approved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Document not found
 */
router.post("/:entityType/:entityId/compliance/:docKey/approve", ...admin, approveComplianceDoc);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/compliance/{docKey}/reject:
 *   post:
 *     summary: Reject a compliance document
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: docKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Compliance document key
 *     responses:
 *       200:
 *         description: Document rejected successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Document not found
 */
router.post("/:entityType/:entityId/compliance/:docKey/reject", ...admin, rejectComplianceDoc);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/system-access-request:
 *   post:
 *     summary: Request system access for an entity
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: System access request payload
 *     responses:
 *       201:
 *         description: System access request created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.post("/:entityType/:entityId/system-access-request", ...admin, requestSystemAccess);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/history:
 *   post:
 *     summary: Add a contact history entry for an entity
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Contact history entry payload
 *     responses:
 *       201:
 *         description: Contact history entry added successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.post("/:entityType/:entityId/history", ...admin, addContactHistory);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/mass-email:
 *   post:
 *     summary: Send a mass email to contacts of an entity
 *     tags: [Client - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Mass email payload (subject, body, recipients, etc.)
 *     responses:
 *       200:
 *         description: Mass email sent successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);


/* ===========================================================
 *  PUT ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/clients/icb/{id}:
 *   put:
 *     summary: Update an ICB by ID
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ICB ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated ICB fields
 *     responses:
 *       200:
 *         description: ICB updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: ICB not found
 */
router.put("/icb/:id", ...admin, updateICB);

/**
 * @swagger
 * /api/clients/federation/{id}:
 *   put:
 *     summary: Update a federation by ID
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Federation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated federation fields
 *     responses:
 *       200:
 *         description: Federation updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Federation not found
 */
router.put("/federation/:id", ...admin, updateFederation);

/**
 * @swagger
 * /api/clients/pcn/{id}:
 *   put:
 *     summary: Update a PCN by ID
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated PCN fields
 *     responses:
 *       200:
 *         description: PCN updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.put("/pcn/:id", ...admin, updatePCN);

/**
 * @swagger
 * /api/clients/pcn/{id}/client-facing:
 *   put:
 *     summary: Update client-facing data for a PCN
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated client-facing data
 *     responses:
 *       200:
 *         description: Client-facing data updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.put("/pcn/:id/client-facing", ...admin, updateClientFacingData);

/**
 * @swagger
 * /api/clients/practice/{id}:
 *   put:
 *     summary: Update a practice by ID
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Practice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated practice fields
 *     responses:
 *       200:
 *         description: Practice updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Practice not found
 */
router.put("/practice/:id", ...admin, updatePractice);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/decision-makers:
 *   put:
 *     summary: Update decision makers for an entity
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated decision makers payload
 *     responses:
 *       200:
 *         description: Decision makers updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.put("/:entityType/:entityId/decision-makers", ...admin, updateDecisionMakers);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/finance-contacts:
 *   put:
 *     summary: Update finance contacts for an entity
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated finance contacts payload
 *     responses:
 *       200:
 *         description: Finance contacts updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.put("/:entityType/:entityId/finance-contacts", ...admin, updateFinanceContacts);

/**
 * @swagger
 * /api/clients/history/{logId}:
 *   put:
 *     summary: Update a contact history entry by log ID
 *     tags: [Client - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *         description: Contact history log ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated contact history fields
 *     responses:
 *       200:
 *         description: Contact history entry updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Log entry not found
 */
router.put("/history/:logId", ...admin, updateContactHistory);


/* ===========================================================
 *  PATCH ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/clients/pcn/{id}/restricted:
 *   patch:
 *     summary: Update restricted clinicians list for a PCN
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Restricted clinicians payload
 *     responses:
 *       200:
 *         description: Restricted clinicians updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: PCN not found
 */
router.patch("/pcn/:id/restricted", ...admin, updateRestrictedClinicians);

/**
 * @swagger
 * /api/clients/practice/{id}/restricted:
 *   patch:
 *     summary: Update restricted flag for a practice
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Practice ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Restricted flag payload
 *     responses:
 *       200:
 *         description: Practice restricted flag updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Practice not found
 */
router.patch("/practice/:id/restricted", ...admin, updatePracticeRestricted);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/documents/{documentId}:
 *   patch:
 *     summary: Upsert an entity document
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Document payload
 *     responses:
 *       200:
 *         description: Document upserted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.patch(
  "/:entityType/:entityId/documents/:documentId",
  ...admin,
  upsertEntityDocument
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/documents/{groupId}/{documentId}/uploads/{uploadId}:
 *   patch:
 *     summary: Update an entity document upload
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document group ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *         description: Upload ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated upload fields
 *     responses:
 *       200:
 *         description: Upload updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Upload not found
 */
router.patch(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
  ...admin,
  updateEntityDocumentUpload
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/compliance/{docKey}:
 *   patch:
 *     summary: Upsert a compliance document (with file upload)
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: docKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Compliance document key
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
 *     responses:
 *       200:
 *         description: Compliance document upserted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity not found
 */
router.patch(
  "/:entityType/:entityId/compliance/:docKey",
  ...admin,
  upload.single("file"),
  upsertComplianceDoc
);

/**
 * @swagger
 * /api/clients/history/{logId}/star:
 *   patch:
 *     summary: Toggle starred flag on a contact history entry
 *     tags: [Client - PATCH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *         description: Contact history log ID
 *     responses:
 *       200:
 *         description: Starred flag toggled successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Log entry not found
 */
router.patch("/history/:logId/star", ...admin, toggleStarred);


/* ===========================================================
 *  DELETE ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/clients/icb/{id}:
 *   delete:
 *     summary: Delete an ICB by ID (Super Admin only)
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ICB ID
 *     responses:
 *       200:
 *         description: ICB deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: ICB not found
 */
router.delete("/icb/:id", ...superOnly, deleteICB);

/**
 * @swagger
 * /api/clients/federation/{id}:
 *   delete:
 *     summary: Delete a federation by ID (Super Admin only)
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Federation ID
 *     responses:
 *       200:
 *         description: Federation deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: Federation not found
 */
router.delete("/federation/:id", ...superOnly, deleteFederation);

/**
 * @swagger
 * /api/clients/pcn/{id}:
 *   delete:
 *     summary: Delete a PCN by ID (Super Admin only)
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PCN ID
 *     responses:
 *       200:
 *         description: PCN deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: PCN not found
 */
router.delete("/pcn/:id", ...superOnly, deletePCN);

/**
 * @swagger
 * /api/clients/practice/{id}:
 *   delete:
 *     summary: Delete a practice by ID (Super Admin only)
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Practice ID
 *     responses:
 *       200:
 *         description: Practice deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: Practice not found
 */
router.delete("/practice/:id", ...superOnly, deletePractice);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/reporting-archive/{reportId}:
 *   delete:
 *     summary: Delete a reporting archive entry
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *         description: Report ID
 *     responses:
 *       200:
 *         description: Reporting archive entry deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Entity or report not found
 */
router.delete(
  "/:entityType/:entityId/reporting-archive/:reportId",
  ...admin,
  deleteFromReportingArchiveV2
);

/**
 * @swagger
 * /api/clients/{entityType}/{entityId}/documents/{groupId}/{documentId}/uploads/{uploadId}:
 *   delete:
 *     summary: Delete an entity document upload
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity type (icb, federation, pcn, practice)
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document group ID
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *         description: Upload ID
 *     responses:
 *       200:
 *         description: Upload deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Upload not found
 */
router.delete(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
  ...admin,
  deleteEntityDocumentUpload
);

/**
 * @swagger
 * /api/clients/history/{logId}:
 *   delete:
 *     summary: Delete a contact history entry by log ID (Super Admin only)
 *     tags: [Client - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: string
 *         description: Contact history log ID
 *     responses:
 *       200:
 *         description: Contact history entry deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: Log entry not found
 */
router.delete("/history/:logId", ...superOnly, deleteContactHistory);

export default router;