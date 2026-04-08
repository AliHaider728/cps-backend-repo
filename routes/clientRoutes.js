// clientRoutes.js — FIXED version
// Static/specific routes PEHLE, dynamic baad mein

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
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
} from "../controllers/complianceController.js";

const router = Router();

const admin    = [verifyToken, allowRoles("super_admin", "director", "ops_manager")];
const adminFin = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "finance")];
const superOnly= [verifyToken, allowRoles("super_admin")];

// ── Public
router.get("/track/:trackingId", trackEmailOpen);

// ── Hierarchy & search
router.get("/hierarchy", ...admin,    getHierarchy);
router.get("/search",    ...adminFin, searchClients);

// ── ICB
router.get   ("/icb",     ...adminFin, getICBs);
router.get   ("/icb/:id", ...adminFin, getICBById);
router.post  ("/icb",     ...admin,    createICB);
router.put   ("/icb/:id", ...admin,    updateICB);
router.delete("/icb/:id", ...superOnly,deleteICB);

// ── Federation
router.get   ("/federation",     ...adminFin, getFederations);
router.post  ("/federation",     ...admin,    createFederation);
router.put   ("/federation/:id", ...admin,    updateFederation);
router.delete("/federation/:id", ...superOnly,deleteFederation);

// ── PCN
router.get   ("/pcn",                ...adminFin, getPCNs);
router.get   ("/pcn/:id",            ...adminFin, getPCNById);
router.get   ("/pcn/:id/rollup",     ...adminFin, getPCNRollup);
router.post  ("/pcn",                ...admin,    createPCN);
router.put   ("/pcn/:id",            ...admin,    updatePCN);
router.delete("/pcn/:id",            ...superOnly,deletePCN);
router.patch ("/pcn/:id/restricted", ...admin,    updateRestrictedClinicians);
router.get   ("/pcn/:id/meetings",   ...admin,    getMonthlyMeetings);
router.post  ("/pcn/:id/meetings",   ...admin,    upsertMonthlyMeeting);

// ── Practice
router.get   ("/practice",                 ...adminFin, getPractices);
router.get   ("/practice/:id",             ...adminFin, getPracticeById);
router.post  ("/practice",                 ...admin,    createPractice);
router.put   ("/practice/:id",             ...admin,    updatePractice);
router.delete("/practice/:id",             ...superOnly,deletePractice);
router.patch ("/practice/:id/restricted",  ...admin,    updatePracticeRestricted);

// ── ✅ STATIC compliance routes PEHLE (warna /:entityType/:entityId match kar leta)
router.get ("/compliance/expiring",   ...adminFin, getExpiringDocs);
router.post("/compliance/run-expiry", ...admin,    runExpiryCheck);

// ── Entity Documents (dynamic routes)
router.get   ("/:entityType/:entityId/documents",                                              ...adminFin, getEntityDocuments);
router.patch ("/:entityType/:entityId/documents/:documentId",                                  ...admin,    upsertEntityDocument);
router.post  ("/:entityType/:entityId/documents/:groupId/:documentId/uploads",                 ...admin,    addEntityDocumentUploads);
router.patch ("/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",       ...admin,    updateEntityDocumentUpload);

// ── Entity Compliance (dynamic routes)
router.get ("/:entityType/:entityId/compliance/status",         ...adminFin, getComplianceStatus);
router.patch("/:entityType/:entityId/compliance/:docKey",        ...admin,    upsertComplianceDoc);
router.post ("/:entityType/:entityId/compliance/:docKey/approve",...admin,    approveComplianceDoc);
router.post ("/:entityType/:entityId/compliance/:docKey/reject", ...admin,    rejectComplianceDoc);

// ── System Access
router.post("/:entityType/:entityId/system-access-request", ...admin, requestSystemAccess);

// ── Contact History
router.get   ("/:entityType/:entityId/history", ...adminFin, getContactHistory);
router.post  ("/:entityType/:entityId/history", ...admin,    addContactHistory);
router.put   ("/history/:logId",                ...admin,    updateContactHistory);
router.patch ("/history/:logId/star",           ...admin,    toggleStarred);
router.delete("/history/:logId",                ...superOnly,deleteContactHistory);

// ── Mass Email
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);

export default router;