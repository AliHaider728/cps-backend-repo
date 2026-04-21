/**
 * clientRoutes.js
 *
 * UPDATED (Apr 2026) — Spec: CPS_Controller_Update_Spec.docx
 *
 * NEW ROUTES (9):
 *   GET    /:entityType/:entityId/reporting-archive          — getReportingArchive
 *   POST   /:entityType/:entityId/reporting-archive          — addToReportingArchive (multer)
 *   DELETE /:entityType/:entityId/reporting-archive/:reportId — deleteFromReportingArchive
 *   GET    /:entityType/:entityId/decision-makers            — getDecisionMakers
 *   PUT    /:entityType/:entityId/decision-makers            — updateDecisionMakers
 *   GET    /:entityType/:entityId/finance-contacts           — getFinanceContacts
 *   PUT    /:entityType/:entityId/finance-contacts           — updateFinanceContacts
 *   GET    /pcn/:id/client-facing                            — getClientFacingData
 *   PUT    /pcn/:id/client-facing                            — updateClientFacingData
 *
 * ROUTE ORDERING RULE (kept from original):
 *   Static / specific routes BEFORE dynamic /:param routes
 */

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
  // ── NEW exports (spec) ───────────────────────────────────────
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
const adminTrn  = [verifyToken, allowRoles("super_admin", "director", "ops_manager", "training")];
const superOnly = [verifyToken, allowRoles("super_admin")];

/* ── Public ─────────────────────────────────────────────────────── */
router.get("/track/:trackingId", trackEmailOpen);

/* ── Hierarchy & Search ──────────────────────────────────────────── */
router.get("/hierarchy", ...admin,    getHierarchy);
router.get("/search",    ...adminFin, searchClients);

/* ── ICB ──────────────────────────────────────────────────────────── */
router.get   ("/icb",     ...adminFin,  getICBs);
router.get   ("/icb/:id", ...adminFin,  getICBById);
router.post  ("/icb",     ...admin,     createICB);
router.put   ("/icb/:id", ...admin,     updateICB);
router.delete("/icb/:id", ...superOnly, deleteICB);

/* ── Federation ───────────────────────────────────────────────────── */
router.get   ("/federation",     ...adminFin,  getFederations);
router.post  ("/federation",     ...admin,     createFederation);
router.put   ("/federation/:id", ...admin,     updateFederation);
router.delete("/federation/:id", ...superOnly, deleteFederation);

/* ── PCN ──────────────────────────────────────────────────────────── */
// ⚠️ Static PCN sub-routes FIRST, then dynamic /:entityType routes below
router.get   ("/pcn",                ...adminFin,  getPCNs);
router.get   ("/pcn/:id",            ...adminFin,  getPCNById);
router.get   ("/pcn/:id/rollup",     ...adminFin,  getPCNRollup);
router.post  ("/pcn",                ...admin,     createPCN);
router.put   ("/pcn/:id",            ...admin,     updatePCN);
router.delete("/pcn/:id",            ...superOnly, deletePCN);
router.patch ("/pcn/:id/restricted", ...admin,     updateRestrictedClinicians);
router.get   ("/pcn/:id/meetings",   ...admin,     getMonthlyMeetings);
router.post  ("/pcn/:id/meetings",   ...admin,     upsertMonthlyMeeting);

// ── NEW: Client-Facing Data (spec §8, §9) ────────────────────────
// ⚠️ Must be BEFORE /:entityType/:entityId dynamic routes
router.get("/pcn/:id/client-facing", ...adminFin, getClientFacingData);
router.put("/pcn/:id/client-facing", ...admin,    updateClientFacingData);

/* ── Practice ─────────────────────────────────────────────────────── */
router.get   ("/practice",                 ...adminFin,  getPractices);
router.get   ("/practice/:id",             ...adminFin,  getPracticeById);
router.post  ("/practice",                 ...admin,     createPractice);
router.put   ("/practice/:id",             ...admin,     updatePractice);
router.delete("/practice/:id",             ...superOnly, deletePractice);
router.patch ("/practice/:id/restricted",  ...admin,     updatePracticeRestricted);

/* ── Static Compliance Routes ────────────────────────────────────────
   ⚠️ MUST be before /:entityType/:entityId — otherwise Express matches
   "compliance" as the entityType param and crashes                    */
router.get ("/compliance/expiring",   ...adminFin, getExpiringDocs);
router.post("/compliance/run-expiry", ...admin,    runExpiryCheck);

/* ── NEW: Reporting Archive ──────────────────────────────────────────
   ⚠️ These are semi-static (known sub-path) — place BEFORE the fully
   dynamic /:entityType/:entityId document/compliance catch-alls       */
router.get   ("/:entityType/:entityId/reporting-archive",
              ...adminFin, getReportingArchive);

router.post  ("/:entityType/:entityId/reporting-archive",
              ...admin, addToReportingArchive);

router.delete("/:entityType/:entityId/reporting-archive/:reportId",
              ...admin, deleteFromReportingArchive);

/* ── NEW: Decision Makers (spec §4, §5) ────────────────────────────── */
router.get("/:entityType/:entityId/decision-makers",
           ...adminFin, getDecisionMakers);

router.put("/:entityType/:entityId/decision-makers",
           ...admin, updateDecisionMakers);

/* ── NEW: Finance Contacts (spec §6, §7) ───────────────────────────── */
router.get("/:entityType/:entityId/finance-contacts",
           ...adminFin, getFinanceContacts);

router.put("/:entityType/:entityId/finance-contacts",
           ...admin, updateFinanceContacts);

/* ── Entity Documents ────────────────────────────────────────────────
   Fully dynamic — must come AFTER all static/semi-static sub-paths   */
router.get   ("/:entityType/:entityId/documents",
              ...adminFin, getEntityDocuments);

router.patch ("/:entityType/:entityId/documents/:documentId",
              ...admin, upsertEntityDocument);

router.post  ("/:entityType/:entityId/documents/:groupId/:documentId/uploads",
              ...admin, addEntityDocumentUploads);

router.patch ("/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
              ...admin, updateEntityDocumentUpload);

router.delete("/:entityType/:entityId/documents/:groupId/:documentId/uploads/:uploadId",
              ...admin, deleteEntityDocumentUpload);

/* ── Entity Compliance ────────────────────────────────────────────── */
router.get  ("/:entityType/:entityId/compliance/status",
             ...adminFin, getComplianceStatus);

router.patch("/:entityType/:entityId/compliance/:docKey",
             ...admin, upsertComplianceDoc);

router.post ("/:entityType/:entityId/compliance/:docKey/approve",
             ...admin, approveComplianceDoc);

router.post ("/:entityType/:entityId/compliance/:docKey/reject",
             ...admin, rejectComplianceDoc);

/* ── System Access ────────────────────────────────────────────────── */
router.post("/:entityType/:entityId/system-access-request",
            ...admin, requestSystemAccess);

/* ── Contact History ──────────────────────────────────────────────── */
router.get   ("/:entityType/:entityId/history", ...adminFin, getContactHistory);
router.post  ("/:entityType/:entityId/history", ...admin,    addContactHistory);
router.put   ("/history/:logId",                ...admin,    updateContactHistory);
router.patch ("/history/:logId/star",           ...admin,    toggleStarred);
router.delete("/history/:logId",                ...superOnly,deleteContactHistory);

/* ── Mass Email ───────────────────────────────────────────────────── */
router.post("/:entityType/:entityId/mass-email", ...admin, sendMassEmail);

export default router;