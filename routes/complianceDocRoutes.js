/**
 * routes/complianceDocRoutes.js — Compliance Document & Group Management
 *
 * Mount in server.js: app.use("/api/compliance", complianceDocRoutes);
 *
 * Endpoints organized: GET → POST → PUT → DELETE (by resource group)
 * Full Swagger annotations included for all routes
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  getComplianceDocs,
  getComplianceDocStats,
  getComplianceDocById,
  createComplianceDoc,
  updateComplianceDoc,
  deleteComplianceDoc,
  getDocumentGroups,
  getDocumentGroupById,
  getGroupsForEntity,
  createDocumentGroup,
  updateDocumentGroup,
  deleteDocumentGroup,
  duplicateDocumentGroup,
} from "../controllers/complianceDocController.js";

const router = Router();

/* ─────────────────────────────────────────────────────────── */
/* ROLE-BASED MIDDLEWARE GROUPS                                */
/* ─────────────────────────────────────────────────────────── */

const superOnly = [verifyToken, allowRoles("super_admin")];

const admin = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];

const anyAuth = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance"),
];

/* ═════════════════════════════════════════════════════════ */
/* TAG: COMPLIANCE DOCUMENTS — GET                            */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/compliance/documents:
 *   get:
 *     tags:
 *       - Compliance Documents
 *     summary: List all compliance documents
 *     description: Retrieve all compliance documents with optional filtering by category, status, or assigned group
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
 *         name: category
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, archived]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of compliance documents retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ComplianceDocument'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get("/documents", ...anyAuth, getComplianceDocs);

/**
 * @swagger
 * /api/compliance/documents/stats:
 *   get:
 *     tags:
 *       - Compliance Documents
 *     summary: Get compliance document statistics
 *     description: Retrieve summary statistics - document counts by category, status, and compliance groups
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Compliance document statistics retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalDocuments:
 *                   type: integer
 *                 byCategory:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                 byStatus:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                 byGroup:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/documents/stats", ...anyAuth, getComplianceDocStats);

/**
 * @swagger
 * /api/compliance/documents/{id}:
 *   get:
 *     tags:
 *       - Compliance Documents
 *     summary: Get compliance document by ID
 *     description: Retrieve a single compliance document with all details and assigned groups
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
 *         description: Compliance document retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDocumentDetail'
 *       404:
 *         description: Document not found
 *       401:
 *         description: Unauthorized
 */
router.get("/documents/:id", ...anyAuth, getComplianceDocById);

/**
 * @swagger
 * /api/compliance/groups:
 *   get:
 *     tags:
 *       - Compliance Groups
 *     summary: List all compliance groups
 *     description: Retrieve all compliance document groups with member counts
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
 *           enum: [active, archived]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of compliance groups retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ComplianceGroup'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/groups", ...anyAuth, getDocumentGroups);

/**
 * @swagger
 * /api/compliance/groups/for-entity/{entityType}:
 *   get:
 *     tags:
 *       - Compliance Groups
 *     summary: Get groups for entity type
 *     description: Retrieve compliance groups applicable to a specific entity type (Clinician, PCN, Practice)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entityType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Clinician, PCN, Practice]
 *     responses:
 *       200:
 *         description: Groups for entity type retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ComplianceGroup'
 *       400:
 *         description: Invalid entity type
 *       401:
 *         description: Unauthorized
 */
router.get("/groups/for-entity/:entityType", ...anyAuth, getGroupsForEntity);

/**
 * @swagger
 * /api/compliance/groups/{id}:
 *   get:
 *     tags:
 *       - Compliance Groups
 *     summary: Get compliance group by ID
 *     description: Retrieve a single compliance group with all assigned documents and members
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
 *         description: Compliance group retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceGroupDetail'
 *       404:
 *         description: Group not found
 *       401:
 *         description: Unauthorized
 */
router.get("/groups/:id", ...anyAuth, getDocumentGroupById);

/* ═════════════════════════════════════════════════════════ */
/* TAG: COMPLIANCE DOCUMENTS — POST                           */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/compliance/documents:
 *   post:
 *     tags:
 *       - Compliance Documents
 *     summary: Create compliance document
 *     description: Create a new compliance document template that can be assigned to groups
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - category
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               renewalFrequency:
 *                 type: string
 *                 enum: [annual, biennial, triennial, on_demand]
 *               expiryDays:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [active, archived]
 *     responses:
 *       201:
 *         description: Compliance document created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDocument'
 *       400:
 *         description: Invalid input
 *       403:
 *         description: Insufficient permissions
 */
router.post("/documents", ...admin, createComplianceDoc);

/**
 * @swagger
 * /api/compliance/groups:
 *   post:
 *     tags:
 *       - Compliance Groups
 *     summary: Create compliance group
 *     description: Create a new compliance group and assign documents to it
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - entityType
 *               - documentIds
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               entityType:
 *                 type: string
 *                 enum: [Clinician, PCN, Practice]
 *               documentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               status:
 *                 type: string
 *                 enum: [active, archived]
 *     responses:
 *       201:
 *         description: Compliance group created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceGroup'
 *       400:
 *         description: Invalid input or documents not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/groups", ...admin, createDocumentGroup);

/**
 * @swagger
 * /api/compliance/groups/{id}/duplicate:
 *   post:
 *     tags:
 *       - Compliance Groups
 *     summary: Duplicate compliance group
 *     description: Clone an existing compliance group with all its documents and settings
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
 *               newName:
 *                 type: string
 *                 description: Name for the cloned group (optional, auto-generated if not provided)
 *     responses:
 *       201:
 *         description: Compliance group duplicated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceGroup'
 *       404:
 *         description: Group not found
 *       403:
 *         description: Insufficient permissions
 */
router.post("/groups/:id/duplicate", ...admin, duplicateDocumentGroup);

/* ═════════════════════════════════════════════════════════ */
/* TAG: COMPLIANCE DOCUMENTS — PUT                            */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/compliance/documents/{id}:
 *   put:
 *     tags:
 *       - Compliance Documents
 *     summary: Update compliance document
 *     description: Update compliance document properties, category, renewal frequency, etc.
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
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               renewalFrequency:
 *                 type: string
 *                 enum: [annual, biennial, triennial, on_demand]
 *               expiryDays:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [active, archived]
 *     responses:
 *       200:
 *         description: Compliance document updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceDocument'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Document not found
 *       403:
 *         description: Insufficient permissions
 */
router.put("/documents/:id", ...admin, updateComplianceDoc);

/**
 * @swagger
 * /api/compliance/groups/{id}:
 *   put:
 *     tags:
 *       - Compliance Groups
 *     summary: Update compliance group
 *     description: Update compliance group name, description, and assigned documents
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               documentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               status:
 *                 type: string
 *                 enum: [active, archived]
 *     responses:
 *       200:
 *         description: Compliance group updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComplianceGroup'
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Group not found
 *       403:
 *         description: Insufficient permissions
 */
router.put("/groups/:id", ...admin, updateDocumentGroup);

/* ═════════════════════════════════════════════════════════ */
/* TAG: COMPLIANCE DOCUMENTS — DELETE                         */
/* ═════════════════════════════════════════════════════════ */

/**
 * @swagger
 * /api/compliance/documents/{id}:
 *   delete:
 *     tags:
 *       - Compliance Documents
 *     summary: Delete compliance document
 *     description: Permanently delete a compliance document and remove it from all groups
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
 *         description: Compliance document deleted
 *       404:
 *         description: Document not found
 *       403:
 *         description: Insufficient permissions (super_admin only)
 *       409:
 *         description: Cannot delete - document is assigned to active groups
 */
router.delete("/documents/:id", ...superOnly, deleteComplianceDoc);

/**
 * @swagger
 * /api/compliance/groups/{id}:
 *   delete:
 *     tags:
 *       - Compliance Groups
 *     summary: Delete compliance group
 *     description: Permanently delete a compliance group and unassign all members
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
 *         description: Compliance group deleted
 *       404:
 *         description: Group not found
 *       403:
 *         description: Insufficient permissions (super_admin only)
 *       409:
 *         description: Cannot delete - group has active members
 */
router.delete("/groups/:id", ...superOnly, deleteDocumentGroup);

/* ─────────────────────────────────────────────────────────── */
/* EXPORT ROUTER                                               */
/* ─────────────────────────────────────────────────────────── */

export default router;