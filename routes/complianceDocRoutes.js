/**
 * complianceDocRoutes.js
 * Mount in server.js:  app.use("/api/compliance", complianceDocRoutes);
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
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

const superOnly = [verifyToken, allowRoles("super_admin")];
const admin     = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const anyAuth   = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance")];

/* ══════════════════════════════════════════════
   COMPLIANCE DOCUMENTS
══════════════════════════════════════════════ */

// GET  /api/compliance/documents         — list all (with filters)
// GET  /api/compliance/documents/stats   — summary counts by category etc.
// GET  /api/compliance/documents/:id     — single doc + which groups contain it
// POST /api/compliance/documents         — create
// PUT  /api/compliance/documents/:id     — update
// DEL  /api/compliance/documents/:id     — delete (super_admin only)

router.get   ("/documents/stats", ...anyAuth,   getComplianceDocStats);  // ⚠️ before /:id
router.get   ("/documents",       ...anyAuth,   getComplianceDocs);
router.get   ("/documents/:id",   ...anyAuth,   getComplianceDocById);
router.post  ("/documents",       ...admin,     createComplianceDoc);
router.put   ("/documents/:id",   ...admin,     updateComplianceDoc);
router.delete("/documents/:id",   ...superOnly, deleteComplianceDoc);

/* ══════════════════════════════════════════════
   DOCUMENT GROUPS
══════════════════════════════════════════════ */

// GET  /api/compliance/groups                          — list all groups
// GET  /api/compliance/groups/for-entity/:entityType   — groups for Clinician / PCN / Practice
// GET  /api/compliance/groups/:id                      — single group + all available docs
// POST /api/compliance/groups                          — create group
// PUT  /api/compliance/groups/:id                      — update group
// DEL  /api/compliance/groups/:id                      — delete (super_admin only)
// POST /api/compliance/groups/:id/duplicate            — clone group

router.get   ("/groups/for-entity/:entityType", ...anyAuth,   getGroupsForEntity);   // ⚠️ before /:id
router.get   ("/groups",                        ...anyAuth,   getDocumentGroups);
router.get   ("/groups/:id",                    ...anyAuth,   getDocumentGroupById);
router.post  ("/groups",                        ...admin,     createDocumentGroup);
router.put   ("/groups/:id",                    ...admin,     updateDocumentGroup);
router.delete("/groups/:id",                    ...superOnly, deleteDocumentGroup);
router.post  ("/groups/:id/duplicate",          ...admin,     duplicateDocumentGroup);

export default router;