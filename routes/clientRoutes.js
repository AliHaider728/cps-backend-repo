import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import {
  getICBs, createICB, updateICB, deleteICB,
  getPCNs, getPCNById, createPCN, updatePCN, deletePCN, updateRestrictedClinicians,
  getPractices, getPracticeById, createPractice, updatePractice, deletePractice,
  getContactHistory, addContactHistory, toggleStarred, deleteContactHistory,
  sendMassEmail, trackEmailOpen,
  getHierarchy,
} from "../controllers/clientController.js";

const router = Router();
const admin  = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];

// ── Public tracking pixel (no auth)  
router.get("/track/:trackingId", trackEmailOpen);

// ── Hierarchy overview 
router.get("/hierarchy", ...admin, getHierarchy);

// ── ICB  
router.get   ("/icb",     ...admin, getICBs);
router.post  ("/icb",     ...admin, createICB);
router.put   ("/icb/:id", ...admin, updateICB);
router.delete("/icb/:id", verifyToken, allowRoles("super_admin"), deleteICB);

// ── PCN  
router.get   ("/pcn",                        ...admin, getPCNs);
router.get   ("/pcn/:id",                    ...admin, getPCNById);
router.post  ("/pcn",                        ...admin, createPCN);
router.put   ("/pcn/:id",                    ...admin, updatePCN);
router.delete("/pcn/:id",                    verifyToken, allowRoles("super_admin"), deletePCN);
router.patch ("/pcn/:id/restricted",         ...admin, updateRestrictedClinicians);

// ── Practice 
router.get   ("/practice",     ...admin, getPractices);
router.get   ("/practice/:id", ...admin, getPracticeById);
router.post  ("/practice",     ...admin, createPractice);
router.put   ("/practice/:id", ...admin, updatePractice);
router.delete("/practice/:id", verifyToken, allowRoles("super_admin"), deletePractice);

// ── Contact History  
router.get   ("/:entityType/:entityId/history",          ...admin, getContactHistory);
router.post  ("/:entityType/:entityId/history",          ...admin, addContactHistory);
router.patch ("/history/:logId/star",                    ...admin, toggleStarred);
router.delete("/history/:logId",                         verifyToken, allowRoles("super_admin"), deleteContactHistory);

// ── Mass Email  
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);

export default router;