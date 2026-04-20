/**
 * complianceController.js
 *
 * UPDATED (Apr 2026) — Spec: CPS_Controller_Update_Spec.docx
 *
 * getEntityDocumentContext   — populate select now includes clinicianCanUpload,
 *                              visibleToClinician, notes (spec §1)
 * normalizePopulatedDoc      — returns clinicianCanUpload, visibleToClinician,
 *                              notes in normalized output (spec §2)
 * buildEntityDocumentsPayload — each doc row now includes clinicianCanUpload +
 *                               visibleToClinician for frontend upload-button
 *                               visibility (spec §3)
 * getExpiringDocs            — also checks groupDocuments[].uploads[] for expiry,
 *                              uses doc.defaultReminderDays as threshold (spec §4)
 * runExpiryCheck             — second loop added for groupDocuments uploads
 *                              (spec §5)
 * getComplianceStatus        — groupDocumentsSummary added, combined overallPct
 *                              from both complianceDocs + groupDocuments (spec §6)
 *
 * All previous fixes kept:
 *   • buildSelectedGroups: group._id check only
 *   • normalizeEntityType() before getModel() throughout
 *   • getRecordUploads: record = record ?? {}
 */

import PCN           from "../models/PCN.js";
import Practice      from "../models/Practice.js";
import DocumentGroup from "../models/DocumentGroup.js";
import ComplianceDocument from "../models/ComplianceDocument.js";
import nodemailer    from "nodemailer";
import { logAudit }  from "../middleware/auditLogger.js";
import { createId, isValidId } from "../lib/ids.js";
import { uploadBufferToStorage } from "../lib/supabase.js";

const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ── Doc type definitions ─────────────────────────────────────────── */
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

/* ── Error helpers ─────────────────────────────────────────────────── */
function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function isDatabaseUnavailableError(err) {
  if (!err) return false;
  const knownNames = new Set(["DatabaseConnectionError", "PostgresError"]);
  if (knownNames.has(err.name)) return true;
  const msg = String(err.message || "").toLowerCase();
  return msg.includes("buffering timed out") || msg.includes("topology was destroyed");
}

function toHttpError(err, fallbackMessage) {
  if (err?.statusCode) return err;
  if (isDatabaseUnavailableError(err)) return createHttpError(503, "Database connection unavailable");
  return createHttpError(500, fallbackMessage);
}

function isValidObjectId(value) {
  return isValidId(String(value || ""));
}

function ensureValidObjectId(value, label) {
  if (!isValidObjectId(value)) throw createHttpError(400, `Invalid ${label}`);
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

/* ─────────────────────────────────────────────────────────────────────
   normalizePopulatedDoc
   UPDATED (spec §2): +clinicianCanUpload, +visibleToClinician, +notes
───────────────────────────────────────────────────────────────────── */
function normalizePopulatedDoc(doc) {
  if (!doc || typeof doc !== "object") return null;
  const docId = doc._id || doc.id;
  if (!docId) return null;
  return {
    _id:                docId,
    name:               doc.name || "Unnamed document",
    displayOrder:       doc.displayOrder ?? 0,
    mandatory:          !!doc.mandatory,
    expirable:          !!doc.expirable,
    active:             doc.active !== false,
    defaultExpiryDays:  doc.defaultExpiryDays ?? null,
    defaultReminderDays: doc.defaultReminderDays ?? null,
    // ── NEW (spec §2) ─────────────────────────────
    clinicianCanUpload: !!doc.clinicianCanUpload,
    visibleToClinician: doc.visibleToClinician !== false,
    notes:              doc.notes || "",
  };
}

function normalizePopulatedGroup(group) {
  if (!group || typeof group !== "object") return null;
  const groupId = group._id || group.id;
  if (!groupId) return null;
  return {
    _id:          groupId,
    name:         group.name || "Unknown group",
    active:       group.active ?? false,
    displayOrder: group.displayOrder ?? 0,
    documents:    Array.isArray(group.documents)
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

function normalizeUploadForDocument(upload, docDef) {
  if (!upload || typeof upload !== "object") return upload;
  return {
    ...upload,
    expiryDate: docDef?.expirable ? (upload.expiryDate || null) : null,
  };
}

function getRecordUploads(record, docDef) {
  record = record ?? {};

  const uploads = Array.isArray(record.uploads) && record.uploads.length > 0
    ? record.uploads
    : (record.fileUrl
        ? [{
            uploadId:   record.uploadId || `legacy-${String(record.group || "nogroup")}-${String(record.document || "nodoc")}`,
            fileName:   record.fileName   || "",
            fileUrl:    record.fileUrl    || "",
            mimeType:   record.mimeType   || "",
            fileSize:   record.fileSize   || 0,
            uploadedAt: record.uploadedAt || null,
            expiryDate: record.expiryDate || null,
            renewalDate:record.renewalDate|| null,
            notes:      record.notes      || "",
            reference:  record.reference  || "",
            uploadedBy: record.uploadedBy || null,
            status:     computeUploadStatus(record, docDef),
          }]
        : []);

  return uploads
    .map((upload) => {
      const normalized = normalizeUploadForDocument(upload, docDef);
      return { ...normalized, status: computeUploadStatus(normalized, docDef) };
    })
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

/* ─────────────────────────────────────────────────────────────────────
   getEntityDocumentContext
   UPDATED (spec §1): populate select now includes
     clinicianCanUpload, visibleToClinician, notes
───────────────────────────────────────────────────────────────────── */
async function getEntityDocumentContext(entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  ensureValidObjectId(entityId, `${normalizedType} id`);
  void DocumentGroup;
  void ComplianceDocument;
  const Model = getModel(normalizedType);

  // ── UPDATED select string (spec §1) ────────────────────────────────
  const DOC_SELECT = "name displayOrder mandatory expirable active defaultExpiryDays defaultReminderDays clinicianCanUpload visibleToClinician notes";

  let query = Model.findById(entityId).populate({
    path:   "complianceGroup",
    select: "name active displayOrder documents",
    populate: { path: "documents", select: DOC_SELECT },
  });

  if (normalizedType === "PCN") {
    query = query.populate({
      path:   "complianceGroups",
      select: "name active displayOrder documents",
      populate: { path: "documents", select: DOC_SELECT },
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
      groupDocumentsCount:   Array.isArray(entity?.groupDocuments)   ? entity.groupDocuments.length   : 0,
    });
  } catch (err) {
    console.error("getEntityDocumentContext populate ERROR:", {
      message: err.message, stack: err.stack, entityType: normalizedType, entityId,
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

/* ─────────────────────────────────────────────────────────────────────
   buildEntityDocumentsPayload
   UPDATED (spec §3): each doc row now includes clinicianCanUpload +
     visibleToClinician so frontend can show/hide upload button
───────────────────────────────────────────────────────────────────── */
function buildEntityDocumentsPayload(entity, documents, options = {}) {
  const recordMap = new Map(
    (entity.groupDocuments || []).map((record) => [buildRecordKey(record.group, record.document), record])
  );
  const groupList    = buildSelectedGroups(entity);
  const primaryGroup = normalizePopulatedGroup(entity.complianceGroup);

  const groups = groupList.map((group) => {
    const docsForGroup = (group.documents || [])
      .filter((doc) => doc && doc.active !== false)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name))
      .map((doc) => {
        const record      = recordMap.get(buildRecordKey(group._id, doc._id)) || undefined;
        const uploads     = getRecordUploads(record, doc);
        const latestUpload= uploads[0] || null;
        const status      = latestUpload ? latestUpload.status : "pending";
        return {
          groupId:            String(group._id),
          groupName:          group.name,
          documentId:         String(doc._id),
          name:               doc.name,
          mandatory:          !!doc.mandatory,
          expirable:          !!doc.expirable,
          defaultExpiryDays:  doc.defaultExpiryDays ?? null,
          defaultReminderDays:doc.defaultReminderDays ?? null,
          // ── NEW (spec §3) ──────────────────────────
          clinicianCanUpload: !!doc.clinicianCanUpload,
          visibleToClinician: doc.visibleToClinician !== false,
          uploadCount:        uploads.length,
          latestUpload,
          status,
          uploads,
        };
      });

    return {
      groupId:      String(group._id),
      groupName:    group.name,
      displayOrder: group.displayOrder ?? 0,
      documents:    docsForGroup,
    };
  });

  const rows = groups.flatMap((group) => group.documents);

  return {
    complianceGroup: primaryGroup
      ? { _id: primaryGroup._id, name: primaryGroup.name, active: primaryGroup.active, displayOrder: primaryGroup.displayOrder }
      : null,
    complianceGroups: groupList.map((group) => ({
      _id: group._id, name: group.name, active: group.active, displayOrder: group.displayOrder,
    })),
    usedDefaultDocuments: !!options.usedDefaultDocuments,
    groups,
    documents: rows,
    summary: {
      total:    rows.length,
      uploaded: rows.filter((doc) => doc.status === "uploaded").length,
      pending:  rows.filter((doc) => doc.status === "pending").length,
      expired:  rows.filter((doc) => doc.status === "expired").length,
    },
  };
}

export const getEntityDocuments = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    console.log("[documents] getEntityDocuments INCOMING", { entityType, entityId });

    if (!isValidId(String(entityId || ""))) {
      console.warn("[documents] getEntityDocuments INVALID_ID", { entityType, entityId });
      return res.status(400).json({ message: "Invalid ID" });
    }

    const { normalizedType, entity, documents, usedDefaultDocuments } =
      await getEntityDocumentContext(entityType, entityId);

    if (!entity) {
      return res.status(404).json({ message: `${normalizedType} not found` });
    }

    const groupInfo = buildSelectedGroups(entity).map((group) => ({
      _id: String(group._id), name: group.name,
      documentCount: Array.isArray(group.documents) ? group.documents.length : 0,
    }));
    const groupDocuments = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
    console.log("[documents] getEntityDocuments GROUP_STATE", {
      entityType: normalizedType, entityId,
      complianceGroup: entity.complianceGroup ? String(entity.complianceGroup._id || entity.complianceGroup) : null,
      complianceGroupsCount: Array.isArray(entity.complianceGroups) ? entity.complianceGroups.length : 0,
      selectedGroups: groupInfo,
      groupDocumentsCount: groupDocuments.length,
      resolvedDocumentCount: Array.isArray(documents) ? documents.length : 0,
    });

    res.json({
      entityType: normalizedType,
      entityId:   entity._id,
      entityName: entity.name,
      ...buildEntityDocumentsPayload(entity, documents, { usedDefaultDocuments }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to fetch documents");
    console.error("getEntityDocuments ERROR:", { message: httpErr.message, stack: err.stack });
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

function buildSelectedGroups(entity) {
  const rawGroups = (entity.complianceGroups && entity.complianceGroups.length > 0)
    ? entity.complianceGroups
    : (entity.complianceGroup ? [entity.complianceGroup] : []);
  return rawGroups.map(normalizePopulatedGroup).filter(Boolean);
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
    uploadId:    createId(),
    fileName:    payload.fileName  || "",
    fileUrl:     payload.fileUrl   || "",
    mimeType:    payload.mimeType  || "",
    fileSize:    payload.fileSize  || 0,
    uploadedAt:  new Date(),
    expiryDate:  docDef?.expirable && payload.expiryDate ? new Date(payload.expiryDate) : null,
    renewalDate: payload.renewalDate ? new Date(payload.renewalDate) : null,
    notes:       payload.notes     || "",
    reference:   payload.reference || "",
    uploadedBy:  userId,
  };
  if (!entry.expiryDate && docDef?.expirable && docDef.defaultExpiryDays) {
    entry.expiryDate = new Date(Date.now() + docDef.defaultExpiryDays * 24 * 60 * 60 * 1000);
  }
  const normalized = normalizeUploadForDocument(entry, docDef);
  normalized.status = computeUploadStatus(normalized, docDef);
  return normalized;
}

async function getMultipartUploads(req) {
  const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
  return Promise.all(files.map(async (file) => {
    const uploaded = await uploadBufferToStorage({
      buffer:      file.buffer,
      contentType: file.mimetype || "application/octet-stream",
      fileName:    file.originalname || "upload.bin",
    });
    return {
      fileName:    file.originalname || "upload.bin",
      fileUrl:     uploaded.publicUrl,
      mimeType:    file.mimetype || "application/octet-stream",
      fileSize:    file.size || 0,
      expiryDate:  req.body.expiryDate  || null,
      renewalDate: req.body.renewalDate || null,
      notes:       req.body.notes       || "",
      reference:   req.body.reference   || "",
    };
  }));
}

export const addEntityDocumentUploads = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    if (!buildSelectedGroups(entity).length)
      return res.status(400).json({ message: "Select a compliance group before uploading documents" });

    const { groupId, documentId } = req.params;
    const { targetGroup, targetDoc } = findGroupAndDocument(entity, groupId, documentId);
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    if (!targetDoc)   return res.status(404).json({ message: "Document is not part of the selected group" });

    const uploadsPayload = await getMultipartUploads(req);
    if (!uploadsPayload.length) return res.status(400).json({ message: "At least one upload is required" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (r) => String(r.group) === String(groupId) && String(r.document) === String(documentId)
    );
    const existing   = recordIndex >= 0 ? records[recordIndex] : { group: groupId, document: documentId };
    const nextUploads = [
      ...getRecordUploads(existing, targetDoc),
      ...uploadsPayload.map((u) => makeUploadEntry(u, req.user._id, targetDoc)),
    ];
    const latestUpload = nextUploads[0] || null;
    const nextRecord   = {
      ...existing, group: groupId, document: documentId,
      uploads:     nextUploads,
      fileName:    latestUpload?.fileName  || "",
      fileUrl:     latestUpload?.fileUrl   || "",
      mimeType:    latestUpload?.mimeType  || "",
      fileSize:    latestUpload?.fileSize  || 0,
      uploadedAt:  latestUpload?.uploadedAt || null,
      expiryDate:  latestUpload?.expiryDate || null,
      renewalDate: latestUpload?.renewalDate|| null,
      notes:       latestUpload?.notes     || "",
      reference:   latestUpload?.reference || "",
      uploadedBy:  latestUpload?.uploadedBy|| null,
      lastUpdatedBy: req.user._id,
      status:      latestUpload?.status || "pending",
    };
    if (recordIndex >= 0) records[recordIndex] = nextRecord;
    else records.push(nextRecord);

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(req.params.entityId, { $set: { groupDocuments: records } }, { new: true, runValidators: false });
    await logAudit(req, "DOCUMENT_UPLOAD", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document uploaded (group: ${groupId}, document: ${documentId}, files: ${uploadsPayload.length})`,
      after: { entityType: normalizedType, entityId: req.params.entityId, groupId, documentId, uploadCount: nextUploads.length },
    });
    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Uploads added", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, { usedDefaultDocuments: refreshed.usedDefaultDocuments }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to add uploads");
    console.error("addEntityDocumentUploads ERROR:", httpErr.message);
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const updateEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    const selectedGroups = buildSelectedGroups(entity);
    const targetGroup = selectedGroups.find((g) => String(g._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    const targetDoc = (targetGroup.documents || []).find((d) => String(d._id) === String(documentId));
    if (!targetDoc)   return res.status(404).json({ message: "Document is not part of the selected group" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (r) => String(r.group) === String(groupId) && String(r.document) === String(documentId)
    );
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record  = { ...records[recordIndex] };
    const uploads = getRecordUploads(record, targetDoc).map((u) => ({ ...u }));
    const uploadIndex = uploads.findIndex((u) => String(u.uploadId) === String(uploadId));
    if (uploadIndex < 0) return res.status(404).json({ message: "Upload not found" });

    const existing    = uploads[uploadIndex];
    const nextUpload  = {
      ...existing,
      ...(req.body.expiryDate  !== undefined && {
        expiryDate: targetDoc?.expirable && req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      }),
      ...(req.body.renewalDate !== undefined && { renewalDate: req.body.renewalDate ? new Date(req.body.renewalDate) : null }),
      ...(req.body.notes       !== undefined && { notes:     req.body.notes     || "" }),
      ...(req.body.reference   !== undefined && { reference: req.body.reference || "" }),
    };
    const normalized  = normalizeUploadForDocument(nextUpload, targetDoc);
    normalized.status = computeUploadStatus(normalized, targetDoc);
    uploads[uploadIndex] = normalized;
    uploads.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    const latest = uploads[0] || null;
    records[recordIndex] = {
      ...record, uploads,
      fileName:    latest?.fileName  || "",
      fileUrl:     latest?.fileUrl   || "",
      mimeType:    latest?.mimeType  || "",
      fileSize:    latest?.fileSize  || 0,
      uploadedAt:  latest?.uploadedAt || null,
      expiryDate:  latest?.expiryDate || null,
      renewalDate: latest?.renewalDate|| null,
      notes:       latest?.notes     || "",
      reference:   latest?.reference || "",
      uploadedBy:  latest?.uploadedBy|| null,
      lastUpdatedBy: req.user._id,
      status:      latest?.status || "pending",
    };

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(req.params.entityId, { $set: { groupDocuments: records } }, { new: true, runValidators: false });
    await logAudit(req, "DOCUMENT_UPDATE", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document upload updated (group: ${groupId}, document: ${documentId}, upload: ${uploadId})`,
    });
    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload updated", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, { usedDefaultDocuments: refreshed.usedDefaultDocuments }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to update upload");
    console.error("updateEntityDocumentUpload ERROR:", httpErr.message);
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const deleteEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity } = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    ensureValidObjectId(groupId,    "group id");
    ensureValidObjectId(documentId, "document id");
    if (!uploadId) return res.status(400).json({ message: "Invalid upload id" });

    const selectedGroups = buildSelectedGroups(entity);
    const targetGroup = selectedGroups.find((g) => String(g._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    const targetDoc = (targetGroup.documents || []).find((d) => String(d._id) === String(documentId));
    if (!targetDoc)   return res.status(404).json({ message: "Document is not part of the selected group" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(
      (r) => String(r.group) === String(groupId) && String(r.document) === String(documentId)
    );
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record    = { ...records[recordIndex] };
    const allUploads = getRecordUploads(record, targetDoc);
    const filtered  = allUploads.filter((u) => String(u.uploadId) !== String(uploadId));
    if (filtered.length === allUploads.length) return res.status(404).json({ message: "Upload not found" });

    if (filtered.length === 0) {
      records.splice(recordIndex, 1);
    } else {
      const latest = filtered[0] || null;
      records[recordIndex] = {
        ...record, uploads: filtered,
        fileName:    latest?.fileName  || "",
        fileUrl:     latest?.fileUrl   || "",
        mimeType:    latest?.mimeType  || "",
        fileSize:    latest?.fileSize  || 0,
        uploadedAt:  latest?.uploadedAt || null,
        expiryDate:  latest?.expiryDate || null,
        renewalDate: latest?.renewalDate|| null,
        notes:       latest?.notes     || "",
        reference:   latest?.reference || "",
        uploadedBy:  latest?.uploadedBy|| null,
        lastUpdatedBy: req.user._id,
        status:      latest?.status || "pending",
      };
    }

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(req.params.entityId, { $set: { groupDocuments: records } }, { new: true, runValidators: false });
    await logAudit(req, "DOCUMENT_DELETE", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document upload deleted (group: ${groupId}, document: ${documentId}, upload: ${uploadId})`,
    });
    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload deleted", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, { usedDefaultDocuments: refreshed.usedDefaultDocuments }),
    });
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to delete upload");
    console.error("deleteEntityDocumentUpload ERROR:", httpErr.message);
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

export const upsertEntityDocument = async (req, res) => {
  try {
    const documentId = String(req.params.documentId);
    const { normalizedType, entity } = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    const groupList  = buildSelectedGroups(entity);
    const targetGroup = groupList.find((g) => (g.documents || []).some((d) => String(d._id) === documentId));
    if (!targetGroup) return res.status(404).json({ message: "Document is not part of the selected compliance group" });
    req.params.groupId = String(targetGroup._id);
    return addEntityDocumentUploads(req, res);
  } catch (err) {
    const httpErr = toHttpError(err, "Failed to update document");
    console.error("upsertEntityDocument ERROR:", httpErr.message);
    res.status(httpErr.statusCode).json({ message: httpErr.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   getComplianceStatus
   UPDATED (spec §6): +groupDocumentsSummary, combined overallPct
───────────────────────────────────────────────────────────────────── */
export const getComplianceStatus = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const Model    = getModel(normalizedType);
    const docTypes = getDocTypes(normalizedType);

    const entity = await Model.findById(entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const complianceDocs = entity.complianceDocs || {};
    const legacyScore    = calcScore(complianceDocs, docTypes);

    // ── NEW: groupDocuments summary (spec §6) ─────────────────────────
    const groupDocs   = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
    const gdTotal     = groupDocs.length;
    const gdUploaded  = groupDocs.filter((r) => r.fileUrl || (Array.isArray(r.uploads) && r.uploads.some((u) => u.fileUrl))).length;
    const gdExpired   = groupDocs.filter((r) => r.status === "expired").length;
    const gdPending   = gdTotal - gdUploaded;

    const groupDocumentsSummary = {
      total:    gdTotal,
      uploaded: gdUploaded,
      pending:  gdPending,
      expired:  gdExpired,
    };

    // Combined score: legacy docs + groupDocuments uploads
    const combinedTotal    = legacyScore.total + gdTotal;
    const combinedDone     = legacyScore.allDone + gdUploaded;
    const overallPct       = combinedTotal > 0 ? Math.round((combinedDone / combinedTotal) * 100) : 100;

    // Per-doc status list (legacy keys)
    const docs = docTypes.map(d => {
      const meta = complianceDocs[d.key] || null;
      let trafficLight = "grey";
      if (meta) {
        if (meta.status === "rejected") trafficLight = "red";
        else if (meta.status === "pending") trafficLight = "amber";
        else if (meta.expiryDate) {
          const diff = new Date(meta.expiryDate) - Date.now();
          if (diff < 0)               trafficLight = "red";
          else if (diff < THIRTY_DAYS_MS) trafficLight = "amber";
          else if (meta.status === "verified") trafficLight = "green";
        } else if (meta.status === "verified") trafficLight = "green";
      }
      return { ...d, meta, trafficLight };
    });

    res.json({
      ...legacyScore,
      overallPct,           // combined overallPct replaces legacy-only value
      groupDocumentsSummary,// NEW
      docs,
      entityName: entity.name,
    });
  } catch (err) {
    console.error("getComplianceStatus ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to get compliance status" });
  }
};

export const upsertComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const Model = getModel(normalizedType);

    const entity = await Model.findById(entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const existing    = entity.complianceDocs?.[docKey] || {};
    const uploadedFile = req.file
      ? await (async () => {
          const uploaded = await uploadBufferToStorage({
            buffer:      req.file.buffer,
            contentType: req.file.mimetype || "application/octet-stream",
            fileName:    req.file.originalname || "upload.bin",
          });
          return {
            fileName: req.file.originalname || "upload.bin",
            fileUrl:  uploaded.publicUrl,
            mimeType: req.file.mimetype || "application/octet-stream",
            fileSize: req.file.size || 0,
          };
        })()
      : null;

    const { fileName, mimeType, fileSize, expiryDate, renewalDate, notes, status } = req.body;
    const nextFileUrl  = uploadedFile?.fileUrl;
    const nextFileName = uploadedFile?.fileName ?? fileName;
    const nextMimeType = uploadedFile?.mimeType ?? mimeType;
    const nextFileSize = uploadedFile?.fileSize ?? fileSize;

    const newMeta = {
      ...existing,
      ...(nextFileName !== undefined && { fileName: nextFileName }),
      ...(nextFileUrl  !== undefined && { fileUrl:  nextFileUrl  }),
      ...(nextMimeType !== undefined && { mimeType: nextMimeType }),
      ...(nextFileSize !== undefined && { fileSize: nextFileSize }),
      ...(notes        !== undefined && { notes }),
      ...(expiryDate   !== undefined && { expiryDate:  expiryDate  ? new Date(expiryDate)  : null }),
      ...(renewalDate  !== undefined && { renewalDate: renewalDate ? new Date(renewalDate) : null }),
      ...(nextFileUrl && nextFileUrl !== existing.fileUrl && {
        status: "pending", uploadedAt: new Date(), version: (existing.version || 0) + 1,
        history: [
          ...(existing.history || []),
          ...(existing.fileUrl ? [{ uploadedAt: existing.uploadedAt, fileName: existing.fileName, fileUrl: existing.fileUrl, status: existing.status, uploadedBy: req.user._id }] : []),
        ],
      }),
      ...(!nextFileUrl && status !== undefined && { status }),
    };

    const updatePayload = { [`complianceDocs.${docKey}`]: newMeta };
    if (newMeta.status === "verified")  updatePayload[docKey] = true;
    else if (newMeta.status === "rejected") updatePayload[docKey] = false;

    const updated = await Model.findByIdAndUpdate(
      entityId, { $set: updatePayload }, { new: true, runValidators: false }
    ).lean();

    res.json({ message: "Compliance document updated", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("upsertComplianceDoc ERROR:", err.message, err.stack);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update compliance document" });
  }
};

export const approveComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const Model = getModel(normalizedType);
    const updated = await Model.findByIdAndUpdate(
      entityId,
      { $set: {
        [`complianceDocs.${docKey}.status`]:          "verified",
        [`complianceDocs.${docKey}.verifiedAt`]:      new Date(),
        [`complianceDocs.${docKey}.verifiedBy`]:      req.user._id,
        [`complianceDocs.${docKey}.rejectionReason`]: "",
        [docKey]: true,
      }},
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: `${normalizedType} not found` });
    res.json({ message: "Document approved", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("approveComplianceDoc ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to approve document" });
  }
};

export const rejectComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: "Rejection reason is required" });

    const normalizedType = normalizeEntityType(entityType);
    const Model = getModel(normalizedType);
    const updated = await Model.findByIdAndUpdate(
      entityId,
      { $set: {
        [`complianceDocs.${docKey}.status`]:          "rejected",
        [`complianceDocs.${docKey}.rejectionReason`]: reason.trim(),
        [docKey]: false,
      }},
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: `${normalizedType} not found` });

    try {
      const contacts = (updated.contacts || []).filter(c => c.email);
      if (contacts.length && process.env.EMAIL_FROM) {
        const docLabel = [...PCN_DOC_TYPES, ...PRACTICE_DOC_TYPES].find(d => d.key === docKey)?.label || docKey;
        for (const c of contacts.slice(0, 1)) {
          await transporter.sendMail({
            from:    process.env.EMAIL_FROM, to: c.email,
            subject: `Action Required: ${docLabel} — Document Rejected`,
            html: `<p>Dear ${c.name || "Team"},</p>
              <p>The document <strong>${docLabel}</strong> has been reviewed and requires re-submission.</p>
              <p><strong>Reason:</strong> ${reason.trim()}</p>
              <p>Please re-upload at your earliest convenience.</p>
              <p>Kind regards,<br/>Core Prescribing Solutions</p>`,
          });
        }
      }
    } catch (mailErr) { console.warn("Rejection email failed:", mailErr.message); }

    res.json({ message: "Document rejected", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("rejectComplianceDoc ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to reject document" });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   getExpiringDocs
   UPDATED (spec §4): also checks groupDocuments[].uploads[] for expiry
     uses doc.defaultReminderDays as threshold instead of hardcoded 30
───────────────────────────────────────────────────────────────────── */
export const getExpiringDocs = async (req, res) => {
  try {
    const days   = Number(req.query.days) || 30;
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const now    = new Date();

    const [pcns, practices] = await Promise.all([
      PCN.find({ isActive: true }).select("name complianceDocs contacts groupDocuments complianceGroup complianceGroups").lean(),
      Practice.find({ isActive: true }).select("name complianceDocs contacts pcn groupDocuments complianceGroup").lean(),
    ]);

    const alerts = [];

    // ── Loop 1: legacy complianceDocs (unchanged) ─────────────────────
    const processLegacy = (entities, type) => {
      const docTypes = getDocTypes(type);
      for (const e of entities) {
        const docs = e.complianceDocs || {};
        for (const d of docTypes) {
          const meta = docs[d.key];
          if (!meta?.expiryDate) continue;
          const expiry   = new Date(meta.expiryDate);
          if (expiry <= cutoff) {
            const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            alerts.push({
              entityType:  type,
              entityId:    e._id,
              entityName:  e.name,
              docKey:      d.key,
              docLabel:    d.label,
              expiryDate:  meta.expiryDate,
              daysLeft,
              isExpired:   daysLeft < 0,
              status:      meta.status,
              source:      "complianceDocs",
            });
          }
        }
      }
    };

    processLegacy(pcns,       "PCN");
    processLegacy(practices,  "Practice");

    // ── Loop 2: groupDocuments uploads (NEW — spec §4) ─────────────────
    // Uses defaultReminderDays from the document definition when available,
    // otherwise falls back to the requested ?days= param.
    const processGroupDocs = async (entities, type) => {
      // Fetch all ComplianceDocument defs in one query for defaultReminderDays lookup
      const allDocDefs = await ComplianceDocument.find({ active: true })
        .select("_id name defaultReminderDays expirable")
        .lean();
      const docDefMap = new Map(allDocDefs.map((d) => [String(d._id), d]));

      for (const e of entities) {
        const groupDocs = Array.isArray(e.groupDocuments) ? e.groupDocuments : [];
        for (const record of groupDocs) {
          const docDef         = docDefMap.get(String(record.document)) || null;
          const reminderDays   = docDef?.defaultReminderDays ?? days; // spec: use doc's own threshold
          const docCutoff      = new Date(Date.now() + reminderDays * 24 * 60 * 60 * 1000);
          const uploads        = getRecordUploads(record, docDef);

          for (const upload of uploads) {
            if (!upload.expiryDate) continue;
            const expiry   = new Date(upload.expiryDate);
            if (expiry <= docCutoff) {
              const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
              alerts.push({
                entityType:   type,
                entityId:     e._id,
                entityName:   e.name,
                groupId:      record.group   ? String(record.group)    : null, // spec §4
                documentId:   record.document ? String(record.document) : null, // spec §4
                documentName: docDef?.name   || "Unknown document",            // spec §4
                uploadId:     upload.uploadId || null,
                expiryDate:   upload.expiryDate,
                daysLeft,
                isExpired:    daysLeft < 0,
                status:       upload.status,
                source:       "groupDocuments", // NEW field to distinguish from legacy
              });
            }
          }
        }
      }
    };

    await processGroupDocs(pcns,      "PCN");
    await processGroupDocs(practices, "Practice");

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

/* ─────────────────────────────────────────────────────────────────────
   runExpiryCheck  (nightly cron)
   UPDATED (spec §5): second loop for groupDocuments uploads
───────────────────────────────────────────────────────────────────── */
export const runExpiryCheck = async (req, res) => {
  try {
    const now        = new Date();
    const thirtyDays = new Date(Date.now() + THIRTY_DAYS_MS);
    let   notified   = 0;

    const [pcns, practices] = await Promise.all([
      PCN.find({ isActive: true }).lean(),
      Practice.find({ isActive: true }).lean(),
    ]);

    // ── Fetch all ComplianceDocument defs once for reminder thresholds ─
    const allDocDefs = await ComplianceDocument.find({ active: true })
      .select("_id name defaultReminderDays expirable")
      .lean();
    const docDefMap  = new Map(allDocDefs.map((d) => [String(d._id), d]));

    const processEntity = async (entity, Model, docTypes) => {
      const docs    = entity.complianceDocs || {};
      const updates = {};
      const emails  = [];

      // ── Loop 1: legacy complianceDocs ──────────────────────────────
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

      // ── Loop 2: groupDocuments uploads (NEW — spec §5) ─────────────
      const groupDocs = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
      const updatedGroupDocs = groupDocs.map((record) => {
        const docDef       = docDefMap.get(String(record.document)) || null;
        const reminderDays = docDef?.defaultReminderDays ?? 30;
        const threshold    = new Date(Date.now() + reminderDays * 24 * 60 * 60 * 1000);
        const uploads      = getRecordUploads(record, docDef).map((upload) => {
          if (!upload.expiryDate) return upload;
          const expiry   = new Date(upload.expiryDate);
          const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

          // Mark upload status as expired if past expiry (spec §5)
          if (expiry < now && upload.status !== "expired") {
            emails.push({ label: docDef?.name || "Document", daysLeft, expired: true });
            return { ...upload, status: "expired" };
          }
          // Reminder if within threshold
          if (daysLeft <= reminderDays && daysLeft > 0) {
            emails.push({ label: docDef?.name || "Document", daysLeft, expired: false });
          }
          return upload;
        });

        // Sync record-level status with latest upload
        const latestUpload = uploads[0] || null;
        return { ...record, uploads, status: latestUpload?.status || record.status };
      });

      // Persist groupDocuments updates if any upload statuses changed
      const groupDocsChanged = JSON.stringify(updatedGroupDocs) !== JSON.stringify(groupDocs);
      if (Object.keys(updates).length || groupDocsChanged) {
        const finalUpdate = { ...updates };
        if (groupDocsChanged) finalUpdate.groupDocuments = updatedGroupDocs;
        await Model.findByIdAndUpdate(entity._id, { $set: finalUpdate });
      }

      // Send reminder email (spec §5 — use entity.contacts or entity.financeContacts)
      if (emails.length) {
        const emailTarget =
          (entity.contacts || []).find(c => c.email)?.email ||
          (entity.financeContacts || []).find(c => c.email)?.email || null;

        if (emailTarget && process.env.EMAIL_FROM) {
          const rows = emails.map(e =>
            `<tr><td>${e.label}</td><td style="color:${e.expired ? "#dc2626" : "#d97706"}">${e.expired ? "EXPIRED" : `${e.daysLeft} days`}</td></tr>`
          ).join("");
          await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to:      emailTarget,
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

    for (const pcn of pcns)      await processEntity(pcn, PCN,      PCN_DOC_TYPES);
    for (const p   of practices) await processEntity(p,   Practice, PRACTICE_DOC_TYPES);

    res.json({ message: "Expiry check complete", notified });
  } catch (err) {
    console.error("runExpiryCheck ERROR:", err.message);
    res.status(500).json({ message: "Failed to run expiry check" });
  }
};