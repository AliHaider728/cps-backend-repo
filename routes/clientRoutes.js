import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import { upload }     from "../middleware/upload.js"; //  KEEP for legacy only

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
  getReportingArchive,
  addToReportingArchive,
  deleteFromReportingArchive,
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

/* ── Public ── */
router.get("/track/:trackingId", trackEmailOpen);

/* ── Hierarchy & Search ── */
router.get("/hierarchy", ...admin, getHierarchy);
router.get("/search", ...adminFin, searchClients);

/* ── ICB ── */
router.get("/icb", ...adminFin, getICBs);
router.get("/icb/:id", ...adminFin, getICBById);
router.post("/icb", ...admin, createICB);
router.put("/icb/:id", ...admin, updateICB);
router.delete("/icb/:id", ...superOnly, deleteICB);

/* ── Federation ── */
router.get("/federation", ...adminFin, getFederations);
router.post("/federation", ...admin, createFederation);
router.put("/federation/:id", ...admin, updateFederation);
router.delete("/federation/:id", ...superOnly, deleteFederation);

/* ── PCN ── */
router.get("/pcn", ...adminFin, getPCNs);
router.get("/pcn/:id", ...adminFin, getPCNById);
router.get("/pcn/:id/rollup", ...adminFin, getPCNRollup);
router.post("/pcn", ...admin, createPCN);
router.put("/pcn/:id", ...admin, updatePCN);
router.delete("/pcn/:id", ...superOnly, deletePCN);
router.patch("/pcn/:id/restricted", ...admin, updateRestrictedClinicians);
router.get("/pcn/:id/meetings", ...admin, getMonthlyMeetings);
router.post("/pcn/:id/meetings", ...admin, upsertMonthlyMeeting);

// Client-facing
router.get("/pcn/:id/client-facing", ...adminFin, getClientFacingData);
router.put("/pcn/:id/client-facing", ...admin, updateClientFacingData);

/* ── Practice ── */
router.get("/practice", ...adminFin, getPractices);
router.get("/practice/:id", ...adminFin, getPracticeById);
router.post("/practice", ...admin, createPractice);
router.put("/practice/:id", ...admin, updatePractice);
router.delete("/practice/:id", ...superOnly, deletePractice);
router.patch("/practice/:id/restricted", ...admin, updatePracticeRestricted);

/* ── Static Compliance ── */
router.get("/compliance/expiring", ...adminFin, getExpiringDocs);
router.post("/compliance/run-expiry", ...admin, runExpiryCheck);

/* ── Reporting Archive ( FIXED - NO MULTER) ── */
router.get("/:entityType/:entityId/reporting-archive", ...adminFin, getReportingArchive);

router.post(
  "/:entityType/:entityId/reporting-archive",
  ...admin,
  addToReportingArchive   //  JSON only
);

router.delete(
  "/:entityType/:entityId/reporting-archive/:reportId",
  ...admin,
  deleteFromReportingArchive
);

/* ── Decision Makers ── */
router.get("/:entityType/:entityId/decision-makers", ...adminFin, getDecisionMakers);
router.put("/:entityType/:entityId/decision-makers", ...admin, updateDecisionMakers);

/* ── Finance Contacts ── */
router.get("/:entityType/:entityId/finance-contacts", ...adminFin, getFinanceContacts);
router.put("/:entityType/:entityId/finance-contacts", ...admin, updateFinanceContacts);

/* ── Entity Documents ( FIXED - NO MULTER) ── */
router.get("/:entityType/:entityId/documents", ...adminFin, getEntityDocuments);

router.patch("/:entityType/:entityId/documents/:documentId",
  ...admin,
  upsertEntityDocument
);

//  MOST IMPORTANT FIX
router.post(
  "/:entityType/:entityId/documents/:groupId/:documentId/uploads",
  ...admin,
  addEntityDocumentUploads   //  JSON uploads[]
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

/* ── Compliance ( KEEP MULTER HERE ONLY) ── */
router.get("/:entityType/:entityId/compliance/status", ...adminFin, getComplianceStatus);

//  ONLY PLACE MULTER SHOULD EXIST
router.patch(
  "/:entityType/:entityId/compliance/:docKey",
  ...admin,
  upload.single("file"),
  upsertComplianceDoc
);

router.post("/:entityType/:entityId/compliance/:docKey/approve", ...admin, approveComplianceDoc);
router.post("/:entityType/:entityId/compliance/:docKey/reject", ...admin, rejectComplianceDoc);

/* ── System Access ── */
router.post("/:entityType/:entityId/system-access-request", ...admin, requestSystemAccess);

/* ── Contact History ── */
router.get("/:entityType/:entityId/history", ...adminFin, getContactHistory);
router.post("/:entityType/:entityId/history", ...admin, addContactHistory);
router.put("/history/:logId", ...admin, updateContactHistory);
router.patch("/history/:logId/star", ...admin, toggleStarred);
router.delete("/history/:logId", ...superOnly, deleteContactHistory);

/* ── Mass Email ── */
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);

export default router;