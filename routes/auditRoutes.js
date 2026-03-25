import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles }  from "../middleware/roleCheck.js";
import { getAuditLogs } from "../controllers/auditController.js";

const router = Router();

router.get("/", verifyToken, allowRoles("super_admin"), getAuditLogs);

export default router;