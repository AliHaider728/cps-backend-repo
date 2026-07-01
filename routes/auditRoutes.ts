/**
 * routes/auditRoutes.ts
 *
 * Mounted at /api/audit by server.js.
 */

import { Router, Request, Response, NextFunction } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles }  from "../middleware/roleCheck.js";
import { getAuditLogs } from "../controllers/auditController.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Audit - GET
 *     description: Read / fetch endpoints
 */

/* ===========================================================
 *  GET ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/audit:
 *   get:
 *     summary: Get audit logs (Super Admin only)
 *     tags: [Audit - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of audit logs
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 */
router.get("/", verifyToken, allowRoles("super_admin"), getAuditLogs);

export default router;
