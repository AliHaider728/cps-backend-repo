import { Router } from "express";
import * as xeroController from "../controllers/xeroController.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Xero - GET
 *     description: Xero integration read endpoints
 *   - name: Xero - POST
 *     description: Xero integration action endpoints
 */

// ===========================================================
// GET ROUTES
// ===========================================================

/**
 * @swagger
 * /api/xero/connect:
 *   get:
 *     summary: Get Xero OAuth authorization URL
 *     tags: [Xero - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully generated authorization URL
 *       500:
 *         description: Server error
 */
router.get("/connect", verifyToken, xeroController.connectXero);

/**
 * @swagger
 * /api/xero/callback:
 *   get:
 *     summary: Xero OAuth callback endpoint
 *     tags: [Xero - GET]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code returned by Xero
 *     responses:
 *       200:
 *         description: Successfully processed callback and exchanged token
 *       500:
 *         description: Server error
 */
// callback doesn't use verifyToken since it's a redirect from Xero,
// but in a production app we'd verify a signed state token or cookie.
router.get("/callback", xeroController.callbackXero);

/**
 * @swagger
 * /api/xero/status:
 *   get:
 *     summary: Get current Xero connection status
 *     tags: [Xero - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection status object
 *       500:
 *         description: Server error
 */
router.get("/status", verifyToken, xeroController.getXeroStatus);

/**
 * @swagger
 * /api/xero/contacts:
 *   get:
 *     summary: Get all Xero contacts for connected tenant
 *     tags: [Xero - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of Xero contacts
 *       500:
 *         description: Server error
 */
router.get("/contacts", verifyToken, xeroController.getContacts);

/**
 * @swagger
 * /api/xero/sync-status:
 *   get:
 *     summary: Get sync status for all clients and clinicians
 *     tags: [Xero - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of entity sync statuses
 *       500:
 *         description: Server error
 */
router.get("/sync-status", verifyToken, xeroController.getSyncStatus);

/**
 * @swagger
 * /api/xero/audit-log:
 *   get:
 *     summary: Get Xero audit log entries
 *     tags: [Xero - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of audit log entries
 *       500:
 *         description: Server error
 */
router.get("/audit-log", verifyToken, xeroController.getAuditLog);


// ===========================================================
// POST ROUTES
// ===========================================================

/**
 * @swagger
 * /api/xero/disconnect:
 *   post:
 *     summary: Disconnect Xero and revoke tokens
 *     tags: [Xero - POST]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully disconnected
 *       500:
 *         description: Server error
 */
router.post("/disconnect", verifyToken, xeroController.disconnectXero);

/**
 * @swagger
 * /api/xero/sync:
 *   post:
 *     summary: Sync a specific contact to Xero
 *     tags: [Xero - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               entityId:
 *                 type: string
 *               entityType:
 *                 type: string
 *                 enum: [client, clinician]
 *     responses:
 *       200:
 *         description: Successfully synced contact
 *       500:
 *         description: Server error
 */
router.post("/sync", verifyToken, xeroController.syncContact);

export default router;