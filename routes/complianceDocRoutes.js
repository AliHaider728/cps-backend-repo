/**
 * complianceDocRoutes.js
 * Mount in server.js:  app.use("/api/compliance", complianceDocRoutes);
 */
import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import {
  getComplianceDocs,
  getComplianceDocById,
  createComplianceDoc,
  updateComplianceDoc,
  deleteComplianceDoc,
  getDocumentGroups,
  getDocumentGroupById,
  createDocumentGroup,
  updateDocumentGroup,
  deleteDocumentGroup,
} from "../controllers/complianceDocController.js";

const router = Router();

const admin     = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const superOnly = [verifyToken, allowRoles("super_admin")];
const anyAuth   = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance")];

// ── Compliance Documents ──────────────────────────────────
router.get   ("/documents",     ...anyAuth,   getComplianceDocs);
router.get   ("/documents/:id", ...anyAuth,   getComplianceDocById);
router.post  ("/documents",     ...admin,     createComplianceDoc);
router.put   ("/documents/:id", ...admin,     updateComplianceDoc);
router.delete("/documents/:id", ...superOnly, deleteComplianceDoc);

// ── Document Groups ───────────────────────────────────────
router.get   ("/groups",     ...anyAuth,   getDocumentGroups);
router.get   ("/groups/:id", ...anyAuth,   getDocumentGroupById);
router.post  ("/groups",     ...admin,     createDocumentGroup);
router.put   ("/groups/:id", ...admin,     updateDocumentGroup);
router.delete("/groups/:id", ...superOnly, deleteDocumentGroup);

export default router;