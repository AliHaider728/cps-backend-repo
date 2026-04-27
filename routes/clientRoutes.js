import { Router } from "express";
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

/* 
   PUBLIC
 */
router.get("/track/:trackingId", trackEmailOpen);

/* 
   HIERARCHY & SEARCH
 */
router.get("/hierarchy", ...admin, getHierarchy);
router.get("/search",    ...adminFin, searchClients);

/* 
   ICB
 */
router.get("/icb",      ...adminFin, getICBs);
router.get("/icb/:id",  ...adminFin, getICBById);
router.post("/icb",     ...admin,    createICB);
router.put("/icb/:id",  ...admin,    updateICB);
router.delete("/icb/:id", ...superOnly, deleteICB);

/* 
   FEDERATION
 */
router.get("/federation",      ...adminFin, getFederations);
router.post("/federation",     ...admin,    createFederation);
router.put("/federation/:id",  ...admin,    updateFederation);
router.delete("/federation/:id", ...superOnly, deleteFederation);

/* 
   PCN
 */
router.get("/pcn",         ...adminFin, getPCNs);
router.get("/pcn/:id",     ...adminFin, getPCNById);
router.get("/pcn/:id/rollup", ...adminFin, getPCNRollup);
router.post("/pcn",        ...admin,    createPCN);
router.put("/pcn/:id",     ...admin,    updatePCN);
router.delete("/pcn/:id",  ...superOnly, deletePCN);
router.patch("/pcn/:id/restricted", ...admin, updateRestrictedClinicians);
router.get("/pcn/:id/meetings",     ...admin, getMonthlyMeetings);
router.post("/pcn/:id/meetings",    ...admin, upsertMonthlyMeeting);

// Client-facing data
router.get("/pcn/:id/client-facing", ...adminFin, getClientFacingData);
router.put("/pcn/:id/client-facing", ...admin,    updateClientFacingData);

/* 
   PRACTICE
 */
router.get("/practice",        ...adminFin, getPractices);
router.get("/practice/:id",    ...adminFin, getPracticeById);
router.post("/practice",       ...admin,    createPractice);
router.put("/practice/:id",    ...admin,    updatePractice);
router.delete("/practice/:id", ...superOnly, deletePractice);
router.patch("/practice/:id/restricted", ...admin, updatePracticeRestricted);

/* 
   STATIC COMPLIANCE
 */
router.get("/compliance/expiring",     ...adminFin, getExpiringDocs);
router.post("/compliance/run-expiry",  ...admin,    runExpiryCheck);

/* 
   REPORTING ARCHIVE  (JSON-based — no multer)
   addToReportingArchive expects JSON body:
     { month, year, reportUrl, fileName, notes, starred }
 */
router.get(
  "/:entityType/:entityId/reporting-archive",
  ...adminFin,
  getReportingArchiveV2
);

router.post(
  "/:entityType/:entityId/reporting-archive",
  ...admin,
  addToReportingArchiveV2   // JSON only — no multer
);
router.delete(
  "/:entityType/:entityId/reporting-archive/:reportId",
  ...admin,
  deleteFromReportingArchiveV2
);

/* 
   DECISION MAKERS
 */
router.get("/:entityType/:entityId/decision-makers", ...adminFin, getDecisionMakers);
router.put("/:entityType/:entityId/decision-makers", ...admin,    updateDecisionMakers);

/* 
   FINANCE CONTACTS
 */
router.get("/:entityType/:entityId/finance-contacts", ...adminFin, getFinanceContacts);
router.put("/:entityType/:entityId/finance-contacts", ...admin,    updateFinanceContacts);

/* 
   ENTITY DOCUMENTS  (JSON-based — no multer)
 */
router.get(
  "/:entityType/:entityId/documents",
  ...adminFin,
  getEntityDocuments
);
router.patch(
  "/:entityType/:entityId/documents/:documentId",
  ...admin,
  upsertEntityDocument
);
router.post(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads",
  ...admin,
  addEntityDocumentUploads   // JSON uploads[]
);
router.patch(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
  ...admin,
  updateEntityDocumentUpload
);
router.delete(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
  ...admin,
  deleteEntityDocumentUpload
);

/* 
   COMPLIANCE  (multer ONLY here)
 */
router.get(
  "/:entityType/:entityId/compliance/status",
  ...adminFin,
  getComplianceStatus
);
router.patch(
  "/:entityType/:entityId/compliance/:docKey",
  ...admin,
  upload.single("file"),   // ONLY place multer is used
  upsertComplianceDoc
);
router.post("/:entityType/:entityId/compliance/:docKey/approve", ...admin, approveComplianceDoc);
router.post("/:entityType/:entityId/compliance/:docKey/reject",  ...admin, rejectComplianceDoc);

/* 
   SYSTEM ACCESS REQUEST
 */
router.post("/:entityType/:entityId/system-access-request", ...admin, requestSystemAccess);

/* 
   CONTACT HISTORY
 */
router.get("/:entityType/:entityId/history",    ...adminFin, getContactHistory);
router.post("/:entityType/:entityId/history",   ...admin,    addContactHistory);
router.put("/history/:logId",                   ...admin,    updateContactHistory);
router.patch("/history/:logId/star",            ...admin,    toggleStarred);
router.delete("/history/:logId",                ...superOnly, deleteContactHistory);

/* 
   MASS EMAIL
 */
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);

export default router;