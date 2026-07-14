import { Router } from "express";
import * as xeroController from "../controllers/xeroController.js";
import { verifyToken } from "../middleware/auth.js";

const router = Router();

// OAuth routes
router.get("/connect", verifyToken, xeroController.connectXero);
// callback doesn't use verifyToken since it's a redirect from Xero,
// but in a production app we'd verify a signed state token or cookie.
router.get("/callback", xeroController.callbackXero);

router.get("/status", verifyToken, xeroController.getXeroStatus);
router.post("/disconnect", verifyToken, xeroController.disconnectXero);

// Sync routes
router.get("/contacts", verifyToken, xeroController.getContacts);
router.get("/sync-status", verifyToken, xeroController.getSyncStatus);
router.post("/sync", verifyToken, xeroController.syncContact);
router.get("/audit-log", verifyToken, xeroController.getAuditLog);

export default router;