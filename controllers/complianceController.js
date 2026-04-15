/**
 * complianceController.js
 *
 * Handles all compliance document operations:
 * - Upload / update document metadata
 * - Approve / Reject documents
 * - Get compliance status
 * - Expiry alerts
 * - Cron-ready expiry check
 *
 * FIXED (Apr 2026):
 *   • buildSelectedGroups: mongoose.isValidObjectId(group) → group._id check only
 *     (was passing whole object instead of string ID — caused 500 crash)
 *   • getComplianceStatus / upsertComplianceDoc / approveComplianceDoc / rejectComplianceDoc:
 *     now call normalizeEntityType() before getModel() — raw lowercase "pcn"/"practice"
 *     was throwing "Invalid entityType" → 500 crash
 *   • getRecordUploads: record = record ?? {} added — null was bypassing default param
 *     causing "Cannot read properties of null (reading 'uploads')" → 500 crash
 */

import mongoose   from "mongoose";
import PCN        from "../models/PCN.js";
import Practice   from "../models/Practice.js";
import DocumentGroup from "../models/DocumentGroup.js";
import ComplianceDocument from "../models/ComplianceDocument.js";
import nodemailer from "nodemailer";
import { logAudit } from "../middleware/auditLogger.js";

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ── Doc type definitions (mirrors frontend) ─────────────────────── */
const PRACTICE_DOC_TYPES = [
  { key: "cqcRating",                 label: "CQC Rating",                 mandatory: true  },
  { key: "indemnityInsurance",        label: "Indemnity Insurance",        mandatory: true,  hasExpiry: true },
  { key: "healthSafety",              label: "Health & Safety Certificate",mandatory: true,  hasExpiry: true },
  { key: "gdprPolicy",               label: "GDPR Policy",                mandatory: true  },
  { key: "informationGovernance",     label: "Information Governance",     mandatory: true  },
  { key: "ndaSigned",                 label: "NDA Signed",                 mandatory: true  },
  { key: "dsaSigned",                 label: "DSA Signed",                 mandatory: true  },
  { key: "mouReceived",               label: "MOU Received",               mandatory: false },
  { key: "welcomePackSent",           label: "Welcome Pack Sent",          mandatory: false },
  { key: "mobilisationPlanSent",      label: "Mobilisation Plan Sent",     mandatory: false },
  { key: "confidentialityFormSigned", label: "Confidentiality Form",       mandatory: true  },
  { key: "prescribingPoliciesShared", label: "Prescribing Policies",       mandatory: false },
  { key: "remoteAccessSetup",         label: "Remote Access Setup",        mandatory: false },
  { key: "templateInstalled",         label: "Template Installed",         mandatory: false },
  { key: "reportsImported",           label: "Reports Imported",           mandatory: false },
];

const PCN_DOC_TYPES = [
  { key: "ndaSigned",       label: "NDA Signed",            mandatory: true  },
  { key: "dsaSigned",       label: "DSA Signed",            mandatory: true  },
  { key: "mouReceived",     label: "MOU Received",          mandatory: true  },
  { key: "gdprAgreement",   label: "GDPR Agreement",        mandatory: true  },
  { key: "welcomePackSent", label: "Welcome Pack Sent",     mandatory: false },
  { key: "insuranceCert",   label: "Insurance Certificate", mandatory: true, hasExpiry: true },
  { key: "govChecklist",    label: "Governance Checklist",  mandatory: true  },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function isDatabaseUnavailableError(err) {
  if (!err) return false;
  const knownNames = new Set([
    "MongoServerSelectionError",
    "MongoNetworkError",
    "MongooseServerSelectionError",
    "DisconnectedError",
  ]);
  if (knownNames.has(err.name)) return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("buffering timed out") || msg.includes("topology was destroyed");
}

function toHttpError(err, fallbackMessage) {
  if (err?.statusCode) return err;
  if (isDatabaseUnavailableError(err)) {
    return createHttpError(503, "Database connection unavailable");
  }
  return createHttpError(500, fallbackMessage);
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value));
}

function ensureValidObjectId(value, label) {
  if (!isValidObjectId(value)) {
    throw createHttpError(400, `Invalid ${label}`);
  }
}

function getModel(entityType) {
  if (entityType === "PCN") return PCN;
  if (entityType === "Practice") return Practice;
  throw new Error("Invalid entityType");
}

function getDocTypes(entityType) {
  return entityType === "PCN" ? PCN_DOC_TYPES : PRACTICE_DOC_TYPES;
}

function calcScore(complianceDocs = {}, docTypes) {
  const mandatory = docTypes.filter(d => d.mandatory);
  const mandatoryDone = mandatory.filter(d => complianceDocs[d.key]?.status === "verified").length;
  const allDone = docTypes.filter(d => complianceDocs[d.key]?.status === "verified").length;
  const overallPct = Math.round((allDone / docTypes.length) * 100);
  const mandatoryPct = mandatory.length ? Math.round((mandatoryDone / mandatory.length) * 100) : 100;

  const expiring = Object.entries(complianceDocs)
    .filter(([, meta]) => {
      if (!meta?.expiryDate) return false;
      const diff = new Date(meta.expiryDate) - Date.now();
      return diff > 0 && diff < THIRTY_DAYS_MS;
    }).length;

  const expired = Object.entries(complianceDocs)
    .filter(([, meta]) => meta?.expiryDate && new Date(meta.expiryDate) < new Date()).length;

  const missing = docTypes.filter(d => d.mandatory && !complianceDocs[d.key]?.status).map(d => d.label);

  return { overallPct, mandatoryPct, allDone, total: docTypes.length, expiring, expired, missing };
}

function normalizeEntityType(entityType = "") {
  const normalized = String(entityType).toLowerCase();
  if (normalized === "pcn") return "PCN";
  if (normalized === "practice") return "Practice";
  throw createHttpError(400, "Invalid entityType");
}

function normalizePopulatedDoc(doc) {
  if (!doc || typeof doc !== "object") return null;
  const docId = doc._id || doc.id;
  if (!docId) return null;
  return {
    _id: docId,
    name: doc.name || "Unnamed document",
    displayOrder: doc.displayOrder ?? 0,
    mandatory: !!doc.mandatory,
    expirable: !!doc.expirable,
    active: doc.active !== false,
    defaultExpiryDays: doc.defaultExpiryDays ?? null,
    defaultReminderDays: doc.defaultReminderDays ?? null,
  };
}

function normalizePopulatedGroup(group) {
  if (!group || typeof group !== "object") return null;
  const groupId = group._id || group.id;
  if (!groupId) return null;
  return {
    _id: groupId,
    name: group.name || "Unknown group",
    active: group.active ?? false,
    displayOrder: group.displayOrder ?? 0,
    documents: Array.isArray(group.documents)
      ? group.documents.map(normalizePopulatedDoc).filter(Boolean)
      : [],
  };
}

function computeDocumentStatus(record, docDef) {
  if (!record?.fileUrl) return "pending";
  if (docDef?.expirable && record.expiryDate && new Date(record.expiryDate) < new Date()) return "expired";
  return record.status === "expired" ? "expired" : "uploaded";
}

function buildRecordKey(groupId, documentId) {
  return `${String(groupId)}:${String(documentId)}`;
}

function computeUploadStatus(upload, docDef) {
  if (!upload?.fileUrl) return "pending";
  if (docDef?.expirable && upload.expiryDate && new Date(upload.expiryDate) < new Date()) return "expired";
  return upload.status === "expired" ? "expired" : "uploaded";
}

//   FIXED: record = record ?? {} — null was bypassing default param `record = {}`
// causing "Cannot read properties of null (reading 'uploads')" → 500 crash
function getRecordUploads(record, docDef) {
  record = record ?? {}; //   handles both null and undefined safely

  const uploads = Array.isArray(record.uploads) && record.uploads.length > 0
    ? record.uploads
    : (record.fileUrl
        ? [{
            uploadId: record.uploadId || `legacy-${String(record.group || "nogroup")}-${String(record.document || "nodoc")}`,
            fileName: record.fileName || "",
            fileUrl: record.fileUrl || "",
            mimeType: record.mimeType || "",
            fileSize: record.fileSize || 0,
            uploadedAt: record.uploadedAt || null,
            expiryDate: record.expiryDate || null,
            renewalDate: record.renewalDate || null,
            notes: record.notes || "",
            reference: record.reference || "",
            uploadedBy: record.uploadedBy || null,
            status: computeUploadStatus(record, docDef),
          }]
        : []);

  return uploads
    .map((upload) => ({
      ...upload,
      status: computeUploadStatus(upload, docDef),
    }))
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

async function getEntityDocumentContext(entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  ensureValidObjectId(entityId, `${normalizedType} id`);
  // Import refs above so nested populate is reliable on serverless cold starts.
  void DocumentGroup;
  void ComplianceDocument;
  const Model = getModel(normalizedType);
  let query = Model.findById(entityId);

  if (Model.schema.path("complianceGroup")) {
    query = query.populate({
      path: "complianceGroup",
      select: "name active displayOrder documents",
      populate: {
        path: "documents",
        select: "name displayOrder mandatory expirable active defaultExpiryDays defaultReminderDays",
      },
    });
  }

  if (normalizedType === "PCN" && Model.schema.path("complianceGroups")) {
    query = query.populate({
      path: "complianceGroups",
      select: "name active displayOrder documents",
      populate: {
        path: "documents",
        select: "name displayOrder mandatory expirable active defaultExpiryDays defaultReminderDays",
      },
    });
  }

  let entity;
  try {
    entity = await query.lean();
    console.log("[documents] getEntityDocumentContext QUERY_RESULT", {
      entityType: normalizedType,
      entityId,
      found: !!entity,
      hasComplianceGroup: !!entity?.complianceGroup,
      complianceGroupsCount: Array.isArray(entity?.complianceGroups) ? entity.complianceGroups.length : 0,
      groupDocumentsCount: Array.isArray(entity?.groupDocuments) ? entity.groupDocuments.length : 0,
    });
  } catch (err) {
    console.error("getEntityDocumentContext populate ERROR:", {
      message: err.message,
      stack: err.stack,
      entityType: normalizedType,
      entityId,
    });
    throw toHttpError(err, "Failed to fetch documents");
  }

  if (!entity) return { normalizedType, entity: null, documents: [], usedDefaultDocuments: false };

  const selectedGroups = buildSelectedGroups(entity);

  const groupDocMap = new Map();
  for (const group of selectedGroups) {
    for (const doc of group?.documents || []) {
      if (!doc || doc.active === false) continue;
      groupDocMap.set(String(doc._id), doc);
    }
  }

  const groupDocs = Array.from(groupDocMap.values())
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));

  return { normalizedType, entity, documents: groupDocs, usedDefaultDocuments: false };
}

function buildEntityDocumentsPayload(entity, documents, options = {}) {
  const recordMap = new Map(
    (entity.groupDocuments || []).map((record) => [buildRecordKey(record.group, record.document), record])
  );
  const groupList = buildSelectedGroups(entity);
  const primaryGroup = normalizePopulatedGroup(entity.complianceGroup);

  const groups = groupList.map((group) => {
    const docsForGroup = (group.documents || [])
      .filter((doc) => doc && doc.active !== false)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name))
      .map((doc) => {
        //   FIXED: was `|| null` — null bypasses default param in getRecordUploads
        // Now using `|| undefined` so the default {} kicks in properly
        const record = recordMap.get(buildRecordKey(group._id, doc._id)) || undefined;
        const uploads = getRecordUploads(record, doc);
        const latestUpload = uploads[0] || null;
        const status = latestUpload ? latestUpload.status : "pending";
        return {
          groupId: String(group._id),
          groupName: group.name,
          documentId: String(doc._id),
          name: doc.name,
          mandatory: !!doc.mandatory,
          expirable: !!doc.expirable,
          defaultExpiryDays: doc.defaultExpiryDays ?? null,
          defaultReminderDays: doc.defaultReminderDays ?? null,
          uploadCount: uploads.length,
          latestUpload,
          status,
          uploads,
        };
      });

    return {
      groupId: String(group._id),
      groupName: group.name,
      displayOrder: group.displayOrder ?? 0,
      documents: docsForGroup,
    };
  });

  const rows = groups.flatMap((group) => group.documents);

  return {
    complianceGroup: primaryGroup
      ? {
          _id: primaryGroup._id,
          name: primaryGroup.name,
          active: primaryGroup.active,
          displayOrder: primaryGroup.displayOrder,
        }
      : null,
    complianceGroups: groupList.map((group) => ({
      _id: group._id,
      name: group.name,
      active: group.active,
      displayOrder: group.displayOrder,
    })),
    usedDefaultDocuments: !!options.usedDefaultDocuments,
    groups,
    documents: rows,
    summary: {
      total: rows.length,
      uploaded: rows.filter((doc) => doc.status === "uploaded").length,
      pending: rows.filter((doc) => doc.status === "pending").length,
      expired: rows.filter((doc) => doc.status === "expired").length,
    },
  };
}

export const getEntityDocuments = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    console.log("[documents] getEntityDocuments INCOMING", { entityType, entityId });

    if (!mongoose.Types.ObjectId.isValid(String(entityId || ""))) {
      console.warn("[documents] getEntityDocuments INVALID_ID", { entityType, entityId });
      return res.status(400).json({ message: "Invalid ID" });
    }

    const { normalizedType, entity, documents, usedDefaultDocuments } = await getEntityDocumentContext(
      entityType,
      entityId
    );

    console.log("[documents] getEntityDocuments ENTITY_FETCHED", {
      entityType: normalizedType,
      entityId,
      found: !!entity,
      entityName: entity?.name || null,
    });

    if (!entity) {
      console.warn("[documents] getEntityDocuments ENTITY_NOT_FOUND", { entityType: normalizedType, entityId });
      return res.status(404).json({ message: `${normalizedType} not found` });
    }

    const groupInfo = buildSelectedGroups(entity).map((group) => ({
      _id: String(group._id),
      name: group.name,
      documentCount: Array.isArray(group.documents) ? group.documents.length : 0,
    }));
    const groupDocuments = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
    console.log("[documents] getEntityDocuments GROUP_STATE", {
      entityType: normalizedType,
      entityId,
      complianceGroup: entity.complianceGroup ? String(entity.complianceGroup._id || entity.complianceGroup) : null,
      complianceGroupsCount: Array.isArray(entity.complianceGroups) ? entity.complianceGroups.length : 0,
      selectedGroups: groupInfo,
      groupDocumentsCount: groupDocuments.length,
      groupDocuments: groupDocuments.map((record) => ({
        group: record?.group ? String(record.group) : null,
        document: record?.document ? String(record.document) : null,
        uploadsCount: Array.isArray(record?.uploads) ? record.uploads.length : 0,
        status: record?.status || null,
      })),
      resolvedDocumentCount: Array.isArray(documents) ? documents.length : 0,
    });

    res.json({
      entityType: normalizedType,
      entityId: entity._id,
      entityName: entity.name,
      ...buildEntityDocumentsPayload(entity, documents, { usedDefaultDocuments }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to fetch documents");
    const crashLine = String(err?.stack || "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("at "));
    console.error("getEntityDocuments ERROR:", {
      message: httpErr.message,
      stack: err.stack || httpErr.stack,
      crashLine: crashLine || null,
      entityType: req.params.entityType,
      entityId: req.params.entityId,
      statusCode: httpErr.statusCode,
      details: err.details || null,
    });
    res.status(httpErr.statusCode).json({
      message: httpErr.message,
    });
  }
};

/* ─────────────────────────────────────────────────
     FIXED: buildSelectedGroups
   BUG: mongoose.isValidObjectId(group) — whole object pass ho raha tha
   FIX: sirf group._id check karo, object already filter ho chuka hai upar
───────────────────────────────────────────────── */
function buildSelectedGroups(entity) {
  const rawGroups = (entity.complianceGroups && entity.complianceGroups.length > 0)
    ? entity.complianceGroups
    : (entity.complianceGroup ? [entity.complianceGroup] : []);

  return rawGroups
    .map(normalizePopulatedGroup)
    .filter(Boolean);
}

function findGroupAndDocument(entity, groupId, documentId) {
  ensureValidObjectId(groupId, "group id");
  ensureValidObjectId(documentId, "document id");
  const selectedGroups = buildSelectedGroups(entity);
  const targetGroup = selectedGroups.find((group) => String(group._id) === String(groupId));
  if (!targetGroup) return { targetGroup: null, targetDoc: null };
  const targetDoc = (targetGroup.documents || []).find((doc) => String(doc._id) === String(documentId));
  return { targetGroup, targetDoc };
}

function makeUploadEntry(payload, userId, docDef) {
  const entry = {
    uploadId: new mongoose.Types.ObjectId().toString(),
    fileName: payload.fileName || "",
    fileUrl: payload.fileUrl || "",
    mimeType: payload.mimeType || "",
    fileSize: payload.fileSize || 0,
    uploadedAt: new Date(),
    expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : null,
    renewalDate: payload.renewalDate ? new Date(payload.renewalDate) : null,
    notes: payload.notes || "",
    reference: payload.reference || "",
    uploadedBy: userId,
  };
  if (!entry.expiryDate && docDef?.expirable && docDef.defaultExpiryDays) {
    entry.expiryDate = new Date(Date.now() + docDef.defaultExpiryDays * 24 * 60 * 60 * 1000);
  }
  entry.status = computeUploadStatus(entry, docDef);
  return entry;
}

export const addEntityDocumentUploads = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    const selectedGroupCount = buildSelectedGroups(entity).length;
    if (!selectedGroupCount) {
      return res.status(400).json({ message: "Select a compliance group before uploading documents" });
    }

    const { groupId, documentId } = req.params;
    const { targetGroup, targetDoc } = findGroupAndDocument(entity, groupId, documentId);
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    if (!targetDoc) return res.status(404).json({ message: "Document is not part of the selected group" });

    const uploadsPayload = Array.isArray(req.body.uploads) ? req.body.uploads : [];
    if (uploadsPayload.length === 0) {
      return res.status(400).json({ message: "At least one upload is required" });
    }

    const records = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (record) => String(record.group) === String(groupId) && String(record.document) === String(documentId)
    );
    const existing = recordIndex >= 0 ? records[recordIndex] : { group: groupId, document: documentId };
    const nextUploads = [
      ...getRecordUploads(existing, targetDoc),
      ...uploadsPayload
        .filter((upload) => upload?.fileUrl)
        .map((upload) => makeUploadEntry(upload, req.user._id, targetDoc)),
    ];

    const latestUpload = nextUploads[0] || null;
    const nextRecord = {
      ...existing,
      group: groupId,
      document: documentId,
      uploads: nextUploads,
      fileName: latestUpload?.fileName || "",
      fileUrl: latestUpload?.fileUrl || "",
      mimeType: latestUpload?.mimeType || "",
      fileSize: latestUpload?.fileSize || 0,
      uploadedAt: latestUpload?.uploadedAt || null,
      expiryDate: latestUpload?.expiryDate || null,
      renewalDate: latestUpload?.renewalDate || null,
      notes: latestUpload?.notes || "",
      reference: latestUpload?.reference || "",
      uploadedBy: latestUpload?.uploadedBy || null,
      lastUpdatedBy: req.user._id,
      status: latestUpload?.status || "pending",
    };

    if (recordIndex >= 0) records[recordIndex] = nextRecord;
    else records.push(nextRecord);

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $set: { groupDocuments: records } },
      { new: true, runValidators: false }
    );

    await logAudit(req, "DOCUMENT_UPLOAD", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document uploaded (group: ${groupId}, document: ${documentId}, files: ${uploadsPayload.length})`,
      after: {
        entityType: normalizedType,
        entityId: req.params.entityId,
        groupId,
        documentId,
        uploadCount: nextUploads.length,
      },
    });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Uploads added",
      entityType: normalizedType,
      entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, {
        usedDefaultDocuments: refreshed.usedDefaultDocuments,
      }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to add uploads");
    console.error("addEntityDocumentUploads ERROR:", {
      message: httpErr.message,
      stack: err.stack || httpErr.stack,
      entityType: req.params.entityType,
      entityId: req.params.entityId,
      groupId: req.params.groupId,
      documentId: req.params.documentId,
      statusCode: httpErr.statusCode,
    });
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const updateEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    const selectedGroups = buildSelectedGroups(entity);
    const targetGroup = selectedGroups.find((group) => String(group._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    const targetDoc = (targetGroup.documents || []).find((doc) => String(doc._id) === String(documentId));
    if (!targetDoc) return res.status(404).json({ message: "Document is not part of the selected group" });

    const records = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (record) => String(record.group) === String(groupId) && String(record.document) === String(documentId)
    );
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record = { ...records[recordIndex] };
    const uploads = getRecordUploads(record, targetDoc).map((upload) => ({ ...upload }));
    const uploadIndex = uploads.findIndex((upload) => String(upload.uploadId) === String(uploadId));
    if (uploadIndex < 0) return res.status(404).json({ message: "Upload not found" });

    const existingUpload = uploads[uploadIndex];
    const nextUpload = {
      ...existingUpload,
      ...(req.body.expiryDate !== undefined && { expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null }),
      ...(req.body.renewalDate !== undefined && { renewalDate: req.body.renewalDate ? new Date(req.body.renewalDate) : null }),
      ...(req.body.notes !== undefined && { notes: req.body.notes || "" }),
      ...(req.body.reference !== undefined && { reference: req.body.reference || "" }),
    };
    nextUpload.status = computeUploadStatus(nextUpload, targetDoc);
    uploads[uploadIndex] = nextUpload;
    uploads.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    const latestUpload = uploads[0] || null;
    records[recordIndex] = {
      ...record,
      uploads,
      fileName: latestUpload?.fileName || "",
      fileUrl: latestUpload?.fileUrl || "",
      mimeType: latestUpload?.mimeType || "",
      fileSize: latestUpload?.fileSize || 0,
      uploadedAt: latestUpload?.uploadedAt || null,
      expiryDate: latestUpload?.expiryDate || null,
      renewalDate: latestUpload?.renewalDate || null,
      notes: latestUpload?.notes || "",
      reference: latestUpload?.reference || "",
      uploadedBy: latestUpload?.uploadedBy || null,
      lastUpdatedBy: req.user._id,
      status: latestUpload?.status || "pending",
    };

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $set: { groupDocuments: records } },
      { new: true, runValidators: false }
    );

    await logAudit(req, "DOCUMENT_UPDATE", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document upload updated (group: ${groupId}, document: ${documentId}, upload: ${uploadId})`,
      after: {
        entityType: normalizedType,
        entityId: req.params.entityId,
        groupId,
        documentId,
        uploadId,
      },
    });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload updated",
      entityType: normalizedType,
      entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, {
        usedDefaultDocuments: refreshed.usedDefaultDocuments,
      }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to update upload");
    console.error("updateEntityDocumentUpload ERROR:", {
      message: httpErr.message,
      stack: err.stack || httpErr.stack,
      entityType: req.params.entityType,
      entityId: req.params.entityId,
      groupId: req.params.groupId,
      documentId: req.params.documentId,
      uploadId: req.params.uploadId,
      statusCode: httpErr.statusCode,
    });
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const deleteEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    ensureValidObjectId(groupId, "group id");
    ensureValidObjectId(documentId, "document id");
    if (!uploadId) return res.status(400).json({ message: "Invalid upload id" });

    const selectedGroups = buildSelectedGroups(entity);
    const targetGroup = selectedGroups.find((group) => String(group._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    const targetDoc = (targetGroup.documents || []).find((doc) => String(doc._id) === String(documentId));
    if (!targetDoc) return res.status(404).json({ message: "Document is not part of the selected group" });

    const records = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (record) => String(record.group) === String(groupId) && String(record.document) === String(documentId)
    );
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record = { ...records[recordIndex] };
    const uploads = getRecordUploads(record, targetDoc)
      .filter((upload) => String(upload.uploadId) !== String(uploadId));
    const removed = uploads.length !== getRecordUploads(record, targetDoc).length;
    if (!removed) return res.status(404).json({ message: "Upload not found" });

    if (uploads.length === 0) {
      records.splice(recordIndex, 1);
    } else {
      const latestUpload = uploads[0] || null;
      records[recordIndex] = {
        ...record,
        uploads,
        fileName: latestUpload?.fileName || "",
        fileUrl: latestUpload?.fileUrl || "",
        mimeType: latestUpload?.mimeType || "",
        fileSize: latestUpload?.fileSize || 0,
        uploadedAt: latestUpload?.uploadedAt || null,
        expiryDate: latestUpload?.expiryDate || null,
        renewalDate: latestUpload?.renewalDate || null,
        notes: latestUpload?.notes || "",
        reference: latestUpload?.reference || "",
        uploadedBy: latestUpload?.uploadedBy || null,
        lastUpdatedBy: req.user._id,
        status: latestUpload?.status || "pending",
      };
    }

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $set: { groupDocuments: records } },
      { new: true, runValidators: false }
    );

    await logAudit(req, "DOCUMENT_DELETE", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document upload deleted (group: ${groupId}, document: ${documentId}, upload: ${uploadId})`,
      after: {
        entityType: normalizedType,
        entityId: req.params.entityId,
        groupId,
        documentId,
        uploadId,
      },
    });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload deleted",
      entityType: normalizedType,
      entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, {
        usedDefaultDocuments: refreshed.usedDefaultDocuments,
      }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to delete upload");
    console.error("deleteEntityDocumentUpload ERROR:", {
      message: httpErr.message,
      stack: err.stack || httpErr.stack,
      entityType: req.params.entityType,
      entityId: req.params.entityId,
      groupId: req.params.groupId,
      documentId: req.params.documentId,
      uploadId: req.params.uploadId,
      statusCode: httpErr.statusCode,
    });
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const upsertEntityDocument = async (req, res) => {
  try {
    const documentId = String(req.params.documentId);
    const { normalizedType, entity, documents } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    const groupList = buildSelectedGroups(entity);
    const targetGroup = groupList.find((group) => (group.documents || []).some((doc) => String(doc._id) === documentId));
    if (!targetGroup) return res.status(404).json({ message: "Document is not part of the selected compliance group" });

    req.params.groupId = String(targetGroup._id);
    req.body.uploads = [{
      fileName: req.body.fileName,
      fileUrl: req.body.fileUrl,
      mimeType: req.body.mimeType,
      fileSize: req.body.fileSize,
      expiryDate: req.body.expiryDate,
      renewalDate: req.body.renewalDate,
      notes: req.body.notes,
      reference: req.body.reference,
    }];
    return addEntityDocumentUploads(req, res);
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to update document");
    console.error("upsertEntityDocument ERROR:", httpErr.message, err.stack || httpErr.stack);
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/clients/:entityType/:entityId/compliance/status
     FIXED: normalizeEntityType() added — raw "pcn"/"practice" was crashing getModel()
──────────────────────────────────────────────────────────────────── */
export const getComplianceStatus = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const normalizedType = normalizeEntityType(entityType); //   FIXED
    const Model    = getModel(normalizedType);              //   was: getModel(entityType)
    const docTypes = getDocTypes(normalizedType);           //   was: getDocTypes(entityType)

    const entity = await Model.findById(entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const complianceDocs = entity.complianceDocs || {};
    const score = calcScore(complianceDocs, docTypes);

    // Build per-doc status list
    const docs = docTypes.map(d => {
      const meta = complianceDocs[d.key] || null;
      let trafficLight = "grey";
      if (meta) {
        if (meta.status === "rejected") trafficLight = "red";
        else if (meta.status === "pending") trafficLight = "amber";
        else if (meta.expiryDate) {
          const diff = new Date(meta.expiryDate) - Date.now();
          if (diff < 0) trafficLight = "red";
          else if (diff < THIRTY_DAYS_MS) trafficLight = "amber";
          else if (meta.status === "verified") trafficLight = "green";
        } else if (meta.status === "verified") trafficLight = "green";
      }
      return { ...d, meta, trafficLight };
    });

    res.json({ ...score, docs, entityName: entity.name });
  } catch (err) {
    console.error("getComplianceStatus ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to get compliance status" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   PATCH /api/clients/:entityType/:entityId/compliance/:docKey
     FIXED: normalizeEntityType() added
──────────────────────────────────────────────────────────────────── */
export const upsertComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType); //   FIXED
    const Model = getModel(normalizedType);                 //   was: getModel(entityType)

    const entity = await Model.findById(entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const existing = entity.complianceDocs?.[docKey] || {};
    const {
      fileName, fileUrl, mimeType, fileSize,
      expiryDate, renewalDate, notes, status
    } = req.body;

    const newMeta = {
      ...existing,
      ...(fileName   !== undefined && { fileName }),
      ...(fileUrl    !== undefined && { fileUrl }),
      ...(mimeType   !== undefined && { mimeType }),
      ...(fileSize   !== undefined && { fileSize }),
      ...(notes      !== undefined && { notes }),
      ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
      ...(renewalDate!== undefined && { renewalDate: renewalDate ? new Date(renewalDate) : null }),
      ...(fileUrl && fileUrl !== existing.fileUrl && {
        status:     "pending",
        uploadedAt: new Date(),
        version:    (existing.version || 0) + 1,
        history: [
          ...(existing.history || []),
          ...(existing.fileUrl ? [{
            uploadedAt: existing.uploadedAt,
            fileName:   existing.fileName,
            fileUrl:    existing.fileUrl,
            status:     existing.status,
            uploadedBy: req.user._id,
          }] : []),
        ],
      }),
      ...(!fileUrl && status !== undefined && { status }),
    };

    const updatePayload = {
      [`complianceDocs.${docKey}`]: newMeta,
    };
    if (newMeta.status === "verified") {
      updatePayload[docKey] = true;
    } else if (newMeta.status === "rejected") {
      updatePayload[docKey] = false;
    }

    const updated = await Model.findByIdAndUpdate(
      entityId,
      { $set: updatePayload },
      { new: true, runValidators: false }
    ).lean();

    res.json({
      message: "Compliance document updated",
      complianceDocs: updated.complianceDocs,
    });
  } catch (err) {
    console.error("upsertComplianceDoc ERROR:", err.message, err.stack);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update compliance document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/clients/:entityType/:entityId/compliance/:docKey/approve
     FIXED: normalizeEntityType() added
──────────────────────────────────────────────────────────────────── */
export const approveComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType); //   FIXED
    const Model = getModel(normalizedType);                 //   was: getModel(entityType)

    const updated = await Model.findByIdAndUpdate(
      entityId,
      {
        $set: {
          [`complianceDocs.${docKey}.status`]:           "verified",
          [`complianceDocs.${docKey}.verifiedAt`]:       new Date(),
          [`complianceDocs.${docKey}.verifiedBy`]:       req.user._id,
          [`complianceDocs.${docKey}.rejectionReason`]:  "",
          [docKey]: true,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: `${normalizedType} not found` });

    res.json({ message: "Document approved", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("approveComplianceDoc ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to approve document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/clients/:entityType/:entityId/compliance/:docKey/reject
     FIXED: normalizeEntityType() added
──────────────────────────────────────────────────────────────────── */
export const rejectComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) return res.status(400).json({ message: "Rejection reason is required" });

    const normalizedType = normalizeEntityType(entityType); //   FIXED
    const Model = getModel(normalizedType);                 //   was: getModel(entityType)

    const updated = await Model.findByIdAndUpdate(
      entityId,
      {
        $set: {
          [`complianceDocs.${docKey}.status`]:          "rejected",
          [`complianceDocs.${docKey}.rejectionReason`]: reason.trim(),
          [docKey]: false,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ message: `${normalizedType} not found` });

    // Send rejection email if contacts exist
    try {
      const contacts = (updated.contacts || []).filter(c => c.email);
      if (contacts.length && process.env.EMAIL_FROM) {
        const docLabel = [...PCN_DOC_TYPES, ...PRACTICE_DOC_TYPES].find(d => d.key === docKey)?.label || docKey;
        for (const c of contacts.slice(0, 1)) {
          await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to:      c.email,
            subject: `Action Required: ${docLabel} — Document Rejected`,
            html: `<p>Dear ${c.name || "Team"},</p>
              <p>The document <strong>${docLabel}</strong> has been reviewed and requires re-submission.</p>
              <p><strong>Reason:</strong> ${reason.trim()}</p>
              <p>Please re-upload the document at your earliest convenience.</p>
              <p>Kind regards,<br/>Core Prescribing Solutions</p>`,
          });
        }
      }
    } catch (mailErr) {
      console.warn("Rejection email failed:", mailErr.message);
    }

    res.json({ message: "Document rejected", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("rejectComplianceDoc ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to reject document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/clients/compliance/expiring?days=30
   Returns all entities with documents expiring within N days
──────────────────────────────────────────────────────────────────── */
export const getExpiringDocs = async (req, res) => {
  try {
    const days    = Number(req.query.days) || 30;
    const cutoff  = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const now     = new Date();

    const [pcns, practices] = await Promise.all([
      PCN.find({ isActive: true }).select("name complianceDocs contacts").lean(),
      Practice.find({ isActive: true }).select("name complianceDocs contacts pcn").lean(),
    ]);

    const alerts = [];

    const process = (entities, type) => {
      const docTypes = getDocTypes(type);
      for (const e of entities) {
        const docs = e.complianceDocs || {};
        for (const d of docTypes) {
          const meta = docs[d.key];
          if (!meta?.expiryDate) continue;
          const expiry = new Date(meta.expiryDate);
          if (expiry <= cutoff) {
            const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            alerts.push({
              entityType:   type,
              entityId:     e._id,
              entityName:   e.name,
              docKey:       d.key,
              docLabel:     d.label,
              expiryDate:   meta.expiryDate,
              daysLeft,
              isExpired:    daysLeft < 0,
              status:       meta.status,
            });
          }
        }
      }
    };

    process(pcns, "PCN");
    process(practices, "Practice");

    alerts.sort((a, b) => a.daysLeft - b.daysLeft);

    res.json({
      alerts,
      summary: {
        total:   alerts.length,
        expired: alerts.filter(a => a.isExpired).length,
        soon:    alerts.filter(a => !a.isExpired).length,
      },
    });
  } catch (err) {
    console.error("getExpiringDocs ERROR:", err.message);
    res.status(500).json({ message: "Failed to get expiring documents" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/clients/compliance/run-expiry-check
   Nightly cron hook — marks expired docs, sends alerts
──────────────────────────────────────────────────────────────────── */
export const runExpiryCheck = async (req, res) => {
  try {
    const now        = new Date();
    const thirtyDays = new Date(Date.now() + THIRTY_DAYS_MS);
    let   notified   = 0;

    const [pcns, practices] = await Promise.all([
      PCN.find({ isActive: true }).lean(),
      Practice.find({ isActive: true }).lean(),
    ]);

    const processEntity = async (entity, Model, docTypes) => {
      const docs    = entity.complianceDocs || {};
      const updates = {};
      const emails  = [];

      for (const d of docTypes) {
        const meta = docs[d.key];
        if (!meta?.expiryDate) continue;
        const expiry   = new Date(meta.expiryDate);
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

        if (expiry < now && meta.status === "verified") {
          updates[`complianceDocs.${d.key}.status`] = "pending";
          updates[d.key] = false;
          emails.push({ label: d.label, daysLeft, expired: true });
        } else if (daysLeft <= 30 && daysLeft > 0) {
          emails.push({ label: d.label, daysLeft, expired: false });
        }
      }

      if (Object.keys(updates).length) {
        await Model.findByIdAndUpdate(entity._id, { $set: updates });
      }

      if (emails.length && entity.contacts?.length) {
        const to = (entity.contacts || []).find(c => c.email)?.email;
        if (to && process.env.EMAIL_FROM) {
          const rows = emails.map(e =>
            `<tr><td>${e.label}</td><td style="color:${e.expired ? '#dc2626' : '#d97706'}">${e.expired ? 'EXPIRED' : `${e.daysLeft} days`}</td></tr>`
          ).join("");
          await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to,
            subject: `Compliance Alert: Documents Requiring Attention — ${entity.name}`,
            html: `<p>The following compliance documents for <strong>${entity.name}</strong> require attention:</p>
              <table border="1" cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
                <tr><th>Document</th><th>Status</th></tr>${rows}
              </table>
              <p>Please log in to the CPS portal to take action.</p>`,
          }).catch(e => console.warn("Expiry email failed:", e.message));
          notified++;
        }
      }
    };

    for (const pcn of pcns)         await processEntity(pcn, PCN, PCN_DOC_TYPES);
    for (const p   of practices)    await processEntity(p, Practice, PRACTICE_DOC_TYPES);

    res.json({ message: "Expiry check complete", notified });
  } catch (err) {
    console.error("runExpiryCheck ERROR:", err.message);
    res.status(500).json({ message: "Failed to run expiry check" });
  }
};