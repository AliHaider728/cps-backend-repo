/**
 * complianceController.js
 * CONVERTED TO POSTGRESQL (Apr 2026)
 *
 * Data stored in app_records table:
 *   model = "client"           → PCN/Clients
 *   model = "practice"         → Practices
 *   model = "document_group"   → DocumentGroups
 *   model = "compliance_document" → ComplianceDocuments
 */

import { v4 as uuidv4 }   from "uuid";
import nodemailer           from "nodemailer";
import { query }            from "../config/db.js";
import { logAudit }         from "../middleware/auditLogger.js";
import { createId, isValidId } from "../lib/ids.js";

/* ── Model names ────────────────────────────────────────────────── */
const CLIENT_MODEL   = "client";
const PRACTICE_MODEL = "practice";
const DOC_GROUP_MODEL= "document_group";
const COMP_DOC_MODEL = "compliance_document";

/* ── Email ──────────────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ── Doc type definitions ───────────────────────────────────────── */
const PRACTICE_DOC_TYPES = [
  { key: "cqcRating",                 label: "CQC Rating",                 mandatory: true  },
  { key: "indemnityInsurance",        label: "Indemnity Insurance",        mandatory: true,  hasExpiry: true },
  { key: "healthSafety",              label: "Health & Safety Certificate",mandatory: true,  hasExpiry: true },
  { key: "gdprPolicy",                label: "GDPR Policy",                mandatory: true  },
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

const CLIENT_DOC_TYPES = [
  { key: "ndaSigned",       label: "NDA Signed",            mandatory: true  },
  { key: "dsaSigned",       label: "DSA Signed",            mandatory: true  },
  { key: "mouReceived",     label: "MOU Received",          mandatory: true  },
  { key: "gdprAgreement",   label: "GDPR Agreement",        mandatory: true  },
  { key: "welcomePackSent", label: "Welcome Pack Sent",     mandatory: false },
  { key: "insuranceCert",   label: "Insurance Certificate", mandatory: true, hasExpiry: true },
  { key: "govChecklist",    label: "Governance Checklist",  mandatory: true  },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/* ══════════════════════════════════════════════════════════════════
   DB HELPERS
══════════════════════════════════════════════════════════════════ */
function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || null,
  };
}

function mapRows(rows) { return (rows || []).map(mapRow).filter(Boolean); }

async function findById(model, id) {
  if (!id) return null;
  const r = await query(
    `SELECT id, data, created_at, updated_at FROM app_records WHERE model = $1 AND id = $2 LIMIT 1`,
    [model, id]
  );
  return mapRow(r.rows[0]);
}

async function updateRecord(model, id, patch) {
  const data = { ...patch, updatedAt: new Date().toISOString() };
  const r    = await query(
    `UPDATE app_records SET data = COALESCE(data,'{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2 RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRow(r.rows[0]);
}

/* ── Helpers ────────────────────────────────────────────────────── */
function normalizeEntityType(entityType = "") {
  const n = String(entityType).toLowerCase();
  if (n === "pcn" || n === "client") return "Client";
  if (n === "practice")              return "Practice";
  throw Object.assign(new Error("Invalid entityType"), { statusCode: 400 });
}

function getModel(entityType) {
  if (entityType === "Client")   return CLIENT_MODEL;
  if (entityType === "Practice") return PRACTICE_MODEL;
  throw new Error("Invalid entityType");
}

function getDocTypes(entityType) {
  return entityType === "Client" ? CLIENT_DOC_TYPES : PRACTICE_DOC_TYPES;
}

function isValidObjectId(value) { return isValidId(String(value || "")); }

function ensureValidObjectId(value, label) {
  if (!isValidObjectId(value))
    throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400 });
}

function createHttpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function toHttpError(err, fallback) {
  if (err?.statusCode) return err;
  return createHttpError(500, fallback);
}

function calcScore(complianceDocs = {}, docTypes) {
  const mandatory     = docTypes.filter(d => d.mandatory);
  const mandatoryDone = mandatory.filter(d => complianceDocs[d.key]?.status === "verified").length;
  const allDone       = docTypes.filter(d => complianceDocs[d.key]?.status === "verified").length;
  const overallPct    = Math.round((allDone / docTypes.length) * 100);
  const mandatoryPct  = mandatory.length ? Math.round((mandatoryDone / mandatory.length) * 100) : 100;

  const expiring = Object.entries(complianceDocs).filter(([, meta]) => {
    if (!meta?.expiryDate) return false;
    const diff = new Date(meta.expiryDate) - Date.now();
    return diff > 0 && diff < THIRTY_DAYS_MS;
  }).length;

  const expired = Object.entries(complianceDocs)
    .filter(([, meta]) => meta?.expiryDate && new Date(meta.expiryDate) < new Date()).length;

  const missing = docTypes.filter(d => d.mandatory && !complianceDocs[d.key]?.status).map(d => d.label);

  return { overallPct, mandatoryPct, allDone, total: docTypes.length, expiring, expired, missing };
}

/* ── Document helpers ───────────────────────────────────────────── */
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
    defaultReminderDays:doc.defaultReminderDays ?? null,
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
  return { ...upload, expiryDate: docDef?.expirable ? (upload.expiryDate || null) : null };
}

function getRecordUploads(record, docDef) {
  record = record ?? {};
  const uploads = Array.isArray(record.uploads) && record.uploads.length > 0
    ? record.uploads
    : (record.fileUrl ? [{
        uploadId:    record.uploadId || `legacy-${String(record.group || "")}-${String(record.document || "")}`,
        fileName:    record.fileName   || "",
        fileUrl:     record.fileUrl    || "",
        mimeType:    record.mimeType   || "",
        fileSize:    record.fileSize   || 0,
        uploadedAt:  record.uploadedAt || null,
        expiryDate:  record.expiryDate || null,
        renewalDate: record.renewalDate|| null,
        notes:       record.notes      || "",
        reference:   record.reference  || "",
        uploadedBy:  record.uploadedBy || null,
        status:      computeUploadStatus(record, docDef),
      }] : []);

  return uploads.map(u => {
    const n = normalizeUploadForDocument(u, docDef);
    return { ...n, status: computeUploadStatus(n, docDef) };
  }).sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

function makeUploadEntry(payload, userId, docDef) {
  const entry = {
    uploadId:    createId(),
    fileName:    payload.fileName  || "",
    fileUrl:     payload.fileUrl   || "",
    mimeType:    payload.mimeType  || "",
    fileSize:    payload.fileSize  || 0,
    uploadedAt:  new Date().toISOString(),
    expiryDate:  docDef?.expirable && payload.expiryDate ? new Date(payload.expiryDate).toISOString() : null,
    renewalDate: payload.renewalDate ? new Date(payload.renewalDate).toISOString() : null,
    notes:       payload.notes     || "",
    reference:   payload.reference || "",
    uploadedBy:  userId,
  };
  if (!entry.expiryDate && docDef?.expirable && docDef.defaultExpiryDays) {
    entry.expiryDate = new Date(Date.now() + docDef.defaultExpiryDays * 86400000).toISOString();
  }
  const normalized = normalizeUploadForDocument(entry, docDef);
  normalized.status = computeUploadStatus(normalized, docDef);
  return normalized;
}

/* ── File uploads now come from frontend Supabase direct upload ─────
   req.body.uploads is an array of { fileUrl, fileName, mimeType, fileSize }
   uploaded directly to Supabase Storage by the frontend.               */
function getMultipartUploads(req) {
  const uploads = Array.isArray(req.body.uploads) ? req.body.uploads : [];
  if (!uploads.length && req.body.fileUrl) {
    // Single-file upload (legacy compliance doc route)
    return [{
      fileName:    req.body.fileName    || "upload.bin",
      fileUrl:     req.body.fileUrl,
      mimeType:    req.body.mimeType    || "application/octet-stream",
      fileSize:    req.body.fileSize    || 0,
      expiryDate:  req.body.expiryDate  || null,
      renewalDate: req.body.renewalDate || null,
      notes:       req.body.notes       || "",
      reference:   req.body.reference   || "",
    }];
  }
  return uploads.map(u => ({
    fileName:    u.fileName    || "upload.bin",
    fileUrl:     u.fileUrl,
    mimeType:    u.mimeType    || "application/octet-stream",
    fileSize:    u.fileSize    || 0,
    expiryDate:  req.body.expiryDate  || null,
    renewalDate: req.body.renewalDate || null,
    notes:       req.body.notes       || "",
    reference:   req.body.reference   || "",
  }));
}

/* ── Build selected groups from entity ──────────────────────────── */
async function buildSelectedGroupsFromEntity(entity) {
  const rawGroups = (entity.complianceGroups && entity.complianceGroups.length > 0)
    ? entity.complianceGroups
    : (entity.complianceGroup ? [entity.complianceGroup] : []);

  const groups = [];
  for (const g of rawGroups) {
    const gId = g?._id || g?.id || g;
    if (!gId) continue;
    const groupRecord = await findById(DOC_GROUP_MODEL, String(gId));
    if (!groupRecord) continue;

    // Populate documents
    const docIds = Array.isArray(groupRecord.documents) ? groupRecord.documents : [];
    const docs   = [];
    for (const dId of docIds) {
      const docId = dId?._id || dId?.id || dId;
      if (!docId) continue;
      const docRecord = await findById(COMP_DOC_MODEL, String(docId));
      if (docRecord && docRecord.active !== false) docs.push(docRecord);
    }
    groups.push({ ...groupRecord, documents: docs });
  }
  return groups.map(normalizePopulatedGroup).filter(Boolean);
}

/* ── getEntityDocumentContext ───────────────────────────────────── */
async function getEntityDocumentContext(entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  ensureValidObjectId(entityId, `${normalizedType} id`);
  const model  = getModel(normalizedType);
  const entity = await findById(model, entityId);

  if (!entity) return { normalizedType, entity: null, documents: [], selectedGroups: [] };

  const selectedGroups = await buildSelectedGroupsFromEntity(entity);
  const groupDocMap    = new Map();
  for (const group of selectedGroups) {
    for (const doc of group?.documents || []) {
      if (!doc || doc.active === false) continue;
      groupDocMap.set(String(doc._id), doc);
    }
  }

  const documents = Array.from(groupDocMap.values())
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));

  return { normalizedType, entity, documents, selectedGroups };
}

/* ── buildEntityDocumentsPayload ────────────────────────────────── */
function buildEntityDocumentsPayload(entity, documents, selectedGroups, options = {}) {
  const recordMap    = new Map(
    (entity.groupDocuments || []).map(r => [buildRecordKey(r.group, r.document), r])
  );
  const primaryGroup = normalizePopulatedGroup(selectedGroups[0] || null);

  const groups = selectedGroups.map(group => {
    const docsForGroup = (group.documents || [])
      .filter(doc => doc && doc.active !== false)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name))
      .map(doc => {
        const record      = recordMap.get(buildRecordKey(group._id, doc._id));
        const uploads     = getRecordUploads(record, doc);
        const latestUpload= uploads[0] || null;
        const status      = latestUpload ? latestUpload.status : "pending";
        return {
          groupId:             String(group._id),
          groupName:           group.name,
          documentId:          String(doc._id),
          name:                doc.name,
          mandatory:           !!doc.mandatory,
          expirable:           !!doc.expirable,
          defaultExpiryDays:   doc.defaultExpiryDays ?? null,
          defaultReminderDays: doc.defaultReminderDays ?? null,
          clinicianCanUpload:  !!doc.clinicianCanUpload,
          visibleToClinician:  doc.visibleToClinician !== false,
          uploadCount:         uploads.length,
          latestUpload, status, uploads,
        };
      });
    return {
      groupId:      String(group._id),
      groupName:    group.name,
      displayOrder: group.displayOrder ?? 0,
      documents:    docsForGroup,
    };
  });

  const rows = groups.flatMap(g => g.documents);

  return {
    complianceGroup: primaryGroup
      ? { _id: primaryGroup._id, name: primaryGroup.name, active: primaryGroup.active, displayOrder: primaryGroup.displayOrder }
      : null,
    complianceGroups: selectedGroups.map(g => ({
      _id: g._id, name: g.name, active: g.active, displayOrder: g.displayOrder,
    })),
    usedDefaultDocuments: !!options.usedDefaultDocuments,
    groups, documents: rows,
    summary: {
      total:    rows.length,
      uploaded: rows.filter(d => d.status === "uploaded").length,
      pending:  rows.filter(d => d.status === "pending").length,
      expired:  rows.filter(d => d.status === "expired").length,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════
   ENTITY DOCUMENTS
══════════════════════════════════════════════════════════════════ */
export const getEntityDocuments = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    if (!isValidId(String(entityId || "")))
      return res.status(400).json({ message: "Invalid ID" });

    const { normalizedType, entity, documents, selectedGroups } =
      await getEntityDocumentContext(entityType, entityId);

    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    res.json({
      entityType: normalizedType, entityId: entity._id, entityName: entity.name,
      ...buildEntityDocumentsPayload(entity, documents, selectedGroups),
    });
  } catch (err) {
    const e = toHttpError(err, "Failed to fetch documents");
    res.status(e.statusCode).json({ message: e.message });
  }
};

export const addEntityDocumentUploads = async (req, res) => {
  try {
    const { normalizedType, entity, selectedGroups } =
      await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    if (!selectedGroups.length)
      return res.status(400).json({ message: "Select a compliance group before uploading documents" });

    const { groupId, documentId } = req.params;
    ensureValidObjectId(groupId,    "group id");
    ensureValidObjectId(documentId, "document id");

    const targetGroup = selectedGroups.find(g => String(g._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned to this entity" });
    const targetDoc = (targetGroup.documents || []).find(d => String(d._id) === String(documentId));
    if (!targetDoc)   return res.status(404).json({ message: "Document is not part of the selected group" });

    const uploadsPayload = await getMultipartUploads(req);
    if (!uploadsPayload.length) return res.status(400).json({ message: "At least one upload is required" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(r => String(r.group) === String(groupId) && String(r.document) === String(documentId));
    const existing    = recordIndex >= 0 ? records[recordIndex] : { group: groupId, document: documentId };
    const nextUploads = [
      ...getRecordUploads(existing, targetDoc),
      ...uploadsPayload.map(u => makeUploadEntry(u, req.user._id, targetDoc)),
    ];
    const latest = nextUploads[0] || null;
    const nextRecord = {
      ...existing, group: groupId, document: documentId, uploads: nextUploads,
      fileName: latest?.fileName || "", fileUrl: latest?.fileUrl || "",
      mimeType: latest?.mimeType || "", fileSize: latest?.fileSize || 0,
      uploadedAt: latest?.uploadedAt || null, expiryDate: latest?.expiryDate || null,
      renewalDate: latest?.renewalDate || null, notes: latest?.notes || "",
      reference: latest?.reference || "", uploadedBy: latest?.uploadedBy || null,
      lastUpdatedBy: req.user._id, status: latest?.status || "pending",
    };
    if (recordIndex >= 0) records[recordIndex] = nextRecord;
    else records.push(nextRecord);

    const model = getModel(normalizedType);
    await updateRecord(model, req.params.entityId, { groupDocuments: records });

    await logAudit(req, "DOCUMENT_UPLOAD", "ClientDocument", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} document uploaded (group: ${groupId}, doc: ${documentId}, files: ${uploadsPayload.length})`,
    });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Uploads added", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, refreshed.selectedGroups),
    });
  } catch (err) {
    const e = toHttpError(err, "Failed to add uploads");
    res.status(e.statusCode).json({ message: e.message });
  }
};

export const updateEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity, selectedGroups } =
      await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    const targetGroup = selectedGroups.find(g => String(g._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned" });
    const targetDoc = (targetGroup.documents || []).find(d => String(d._id) === String(documentId));
    if (!targetDoc)   return res.status(404).json({ message: "Document not found in group" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(r => String(r.group) === String(groupId) && String(r.document) === String(documentId));
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record  = { ...records[recordIndex] };
    const uploads = getRecordUploads(record, targetDoc).map(u => ({ ...u }));
    const uploadIndex = uploads.findIndex(u => String(u.uploadId) === String(uploadId));
    if (uploadIndex < 0) return res.status(404).json({ message: "Upload not found" });

    const next = {
      ...uploads[uploadIndex],
      ...(req.body.expiryDate  !== undefined && { expiryDate:  targetDoc?.expirable && req.body.expiryDate ? new Date(req.body.expiryDate).toISOString() : null }),
      ...(req.body.renewalDate !== undefined && { renewalDate: req.body.renewalDate ? new Date(req.body.renewalDate).toISOString() : null }),
      ...(req.body.notes       !== undefined && { notes:     req.body.notes     || "" }),
      ...(req.body.reference   !== undefined && { reference: req.body.reference || "" }),
    };
    const normalized = normalizeUploadForDocument(next, targetDoc);
    normalized.status = computeUploadStatus(normalized, targetDoc);
    uploads[uploadIndex] = normalized;
    uploads.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

    const latest = uploads[0] || null;
    records[recordIndex] = {
      ...record, uploads,
      fileName: latest?.fileName || "", fileUrl: latest?.fileUrl || "",
      mimeType: latest?.mimeType || "", fileSize: latest?.fileSize || 0,
      uploadedAt: latest?.uploadedAt || null, expiryDate: latest?.expiryDate || null,
      renewalDate: latest?.renewalDate || null, notes: latest?.notes || "",
      reference: latest?.reference || "", uploadedBy: latest?.uploadedBy || null,
      lastUpdatedBy: req.user._id, status: latest?.status || "pending",
    };

    const model = getModel(normalizedType);
    await updateRecord(model, req.params.entityId, { groupDocuments: records });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload updated", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, refreshed.selectedGroups),
    });
  } catch (err) {
    const e = toHttpError(err, "Failed to update upload");
    res.status(e.statusCode).json({ message: e.message });
  }
};

export const deleteEntityDocumentUpload = async (req, res) => {
  try {
    const { normalizedType, entity, selectedGroups } =
      await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const { groupId, documentId, uploadId } = req.params;
    if (!uploadId) return res.status(400).json({ message: "Invalid upload id" });

    const targetGroup = selectedGroups.find(g => String(g._id) === String(groupId));
    if (!targetGroup) return res.status(404).json({ message: "Document group is not assigned" });
    const targetDoc = (targetGroup.documents || []).find(d => String(d._id) === String(documentId));
    if (!targetDoc)   return res.status(404).json({ message: "Document not found in group" });

    const records     = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex(r => String(r.group) === String(groupId) && String(r.document) === String(documentId));
    if (recordIndex < 0) return res.status(404).json({ message: "Upload record not found" });

    const record     = { ...records[recordIndex] };
    const allUploads = getRecordUploads(record, targetDoc);
    const filtered   = allUploads.filter(u => String(u.uploadId) !== String(uploadId));
    if (filtered.length === allUploads.length) return res.status(404).json({ message: "Upload not found" });

    if (filtered.length === 0) {
      records.splice(recordIndex, 1);
    } else {
      const latest = filtered[0] || null;
      records[recordIndex] = {
        ...record, uploads: filtered,
        fileName: latest?.fileName || "", fileUrl: latest?.fileUrl || "",
        mimeType: latest?.mimeType || "", fileSize: latest?.fileSize || 0,
        uploadedAt: latest?.uploadedAt || null, expiryDate: latest?.expiryDate || null,
        renewalDate: latest?.renewalDate || null, notes: latest?.notes || "",
        reference: latest?.reference || "", uploadedBy: latest?.uploadedBy || null,
        lastUpdatedBy: req.user._id, status: latest?.status || "pending",
      };
    }

    const model = getModel(normalizedType);
    await updateRecord(model, req.params.entityId, { groupDocuments: records });

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Upload deleted", entityType: normalizedType, entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents, refreshed.selectedGroups),
    });
  } catch (err) {
    const e = toHttpError(err, "Failed to delete upload");
    res.status(e.statusCode).json({ message: e.message });
  }
};

export const upsertEntityDocument = async (req, res) => {
  try {
    const documentId = String(req.params.documentId);
    const { normalizedType, entity, selectedGroups } =
      await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const targetGroup = selectedGroups.find(g =>
      (g.documents || []).some(d => String(d._id) === documentId)
    );
    if (!targetGroup) return res.status(404).json({ message: "Document is not part of the selected compliance group" });

    req.params.groupId = String(targetGroup._id);
    return addEntityDocumentUploads(req, res);
  } catch (err) {
    const e = toHttpError(err, "Failed to update document");
    res.status(e.statusCode).json({ message: e.message });
  }
};

/* ══════════════════════════════════════════════════════════════════
   COMPLIANCE STATUS
══════════════════════════════════════════════════════════════════ */
export const getComplianceStatus = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const model    = getModel(normalizedType);
    const docTypes = getDocTypes(normalizedType);

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const complianceDocs = entity.complianceDocs || {};
    const legacyScore    = calcScore(complianceDocs, docTypes);

    const groupDocs   = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
    const gdTotal     = groupDocs.length;
    const gdUploaded  = groupDocs.filter(r => r.fileUrl || (Array.isArray(r.uploads) && r.uploads.some(u => u.fileUrl))).length;
    const gdExpired   = groupDocs.filter(r => r.status === "expired").length;
    const gdPending   = gdTotal - gdUploaded;

    const groupDocumentsSummary = { total: gdTotal, uploaded: gdUploaded, pending: gdPending, expired: gdExpired };
    const combinedTotal  = legacyScore.total + gdTotal;
    const combinedDone   = legacyScore.allDone + gdUploaded;
    const overallPct     = combinedTotal > 0 ? Math.round((combinedDone / combinedTotal) * 100) : 100;

    const docs = docTypes.map(d => {
      const meta = complianceDocs[d.key] || null;
      let trafficLight = "grey";
      if (meta) {
        if (meta.status === "rejected") trafficLight = "red";
        else if (meta.status === "pending") trafficLight = "amber";
        else if (meta.expiryDate) {
          const diff = new Date(meta.expiryDate) - Date.now();
          if (diff < 0)                trafficLight = "red";
          else if (diff < THIRTY_DAYS_MS) trafficLight = "amber";
          else if (meta.status === "verified") trafficLight = "green";
        } else if (meta.status === "verified") trafficLight = "green";
      }
      return { ...d, meta, trafficLight };
    });

    res.json({ ...legacyScore, overallPct, groupDocumentsSummary, docs, entityName: entity.name });
  } catch (err) {
    console.error("getComplianceStatus ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to get compliance status" });
  }
};

export const upsertComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const model = getModel(normalizedType);

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const existing = entity.complianceDocs?.[docKey] || {};

    // File metadata from frontend Supabase direct upload
    const { fileUrl, fileName, mimeType, fileSize, expiryDate, renewalDate, notes, status } = req.body;
    const nextFileUrl  = fileUrl  || null;
    const nextFileName = fileName || null;
    const nextMimeType = mimeType || null;
    const nextFileSize = fileSize || 0;

    const newMeta = {
      ...existing,
      ...(nextFileName !== undefined && { fileName: nextFileName }),
      ...(nextFileUrl  !== undefined && { fileUrl:  nextFileUrl  }),
      ...(nextMimeType !== undefined && { mimeType: nextMimeType }),
      ...(nextFileSize !== undefined && { fileSize: nextFileSize }),
      ...(notes        !== undefined && { notes }),
      ...(expiryDate   !== undefined && { expiryDate:  expiryDate  ? new Date(expiryDate).toISOString()  : null }),
      ...(renewalDate  !== undefined && { renewalDate: renewalDate ? new Date(renewalDate).toISOString() : null }),
      ...(nextFileUrl && nextFileUrl !== existing.fileUrl && {
        status: "pending", uploadedAt: new Date().toISOString(), version: (existing.version || 0) + 1,
        history: [...(existing.history || []), ...(existing.fileUrl ? [{ uploadedAt: existing.uploadedAt, fileName: existing.fileName, fileUrl: existing.fileUrl, status: existing.status, uploadedBy: req.user._id }] : [])],
      }),
      ...(!nextFileUrl && status !== undefined && { status }),
    };

    const currentDocs = entity.complianceDocs || {};
    const updatedDocs = { ...currentDocs, [docKey]: newMeta };
    const patch = { complianceDocs: updatedDocs };
    if (newMeta.status === "verified")  patch[docKey] = true;
    else if (newMeta.status === "rejected") patch[docKey] = false;

    await updateRecord(model, entityId, patch);
    res.json({ message: "Compliance document updated", complianceDocs: updatedDocs });
  } catch (err) {
    console.error("upsertComplianceDoc ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update compliance document" });
  }
};

export const approveComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const normalizedType = normalizeEntityType(entityType);
    const model  = getModel(normalizedType);
    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const currentDocs = entity.complianceDocs || {};
    const updatedDocs = {
      ...currentDocs,
      [docKey]: {
        ...(currentDocs[docKey] || {}),
        status: "verified", verifiedAt: new Date().toISOString(),
        verifiedBy: req.user._id, rejectionReason: "",
      },
    };
    await updateRecord(model, entityId, { complianceDocs: updatedDocs, [docKey]: true });
    res.json({ message: "Document approved", complianceDocs: updatedDocs });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to approve document" });
  }
};

export const rejectComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ message: "Rejection reason is required" });

    const normalizedType = normalizeEntityType(entityType);
    const model  = getModel(normalizedType);
    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const currentDocs = entity.complianceDocs || {};
    const updatedDocs = {
      ...currentDocs,
      [docKey]: { ...(currentDocs[docKey] || {}), status: "rejected", rejectionReason: reason.trim() },
    };
    await updateRecord(model, entityId, { complianceDocs: updatedDocs, [docKey]: false });
    res.json({ message: "Document rejected", complianceDocs: updatedDocs });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to reject document" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   EXPIRING DOCS
══════════════════════════════════════════════════════════════════ */
export const getExpiringDocs = async (req, res) => {
  try {
    const days   = Number(req.query.days) || 30;
    const cutoff = new Date(Date.now() + days * 86400000);
    const now    = new Date();
    const alerts = [];

    const [clients, practices] = await Promise.all([
      query(`SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'isActive')::boolean, true) = true`, [CLIENT_MODEL]).then(r => mapRows(r.rows)),
      query(`SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'isActive')::boolean, true) = true`, [PRACTICE_MODEL]).then(r => mapRows(r.rows)),
    ]);

    // Fetch all ComplianceDocument defs for defaultReminderDays
    const allDocDefs = await query(
      `SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'active')::boolean, true) = true`,
      [COMP_DOC_MODEL]
    ).then(r => mapRows(r.rows));
    const docDefMap = new Map(allDocDefs.map(d => [String(d._id), d]));

    const processLegacy = (entities, type) => {
      const docTypes = getDocTypes(type);
      for (const e of entities) {
        const docs = e.complianceDocs || {};
        for (const d of docTypes) {
          const meta = docs[d.key];
          if (!meta?.expiryDate) continue;
          const expiry   = new Date(meta.expiryDate);
          if (expiry <= cutoff) {
            alerts.push({
              entityType: type, entityId: e._id, entityName: e.name,
              docKey: d.key, docLabel: d.label, expiryDate: meta.expiryDate,
              daysLeft: Math.ceil((expiry - now) / 86400000),
              isExpired: expiry < now, status: meta.status, source: "complianceDocs",
            });
          }
        }
      }
    };

    const processGroupDocs = (entities, type) => {
      for (const e of entities) {
        const groupDocs = Array.isArray(e.groupDocuments) ? e.groupDocuments : [];
        for (const record of groupDocs) {
          const docDef       = docDefMap.get(String(record.document)) || null;
          const reminderDays = docDef?.defaultReminderDays ?? days;
          const docCutoff    = new Date(Date.now() + reminderDays * 86400000);
          const uploads      = getRecordUploads(record, docDef);
          for (const upload of uploads) {
            if (!upload.expiryDate) continue;
            const expiry = new Date(upload.expiryDate);
            if (expiry <= docCutoff) {
              alerts.push({
                entityType: type, entityId: e._id, entityName: e.name,
                groupId: record.group ? String(record.group) : null,
                documentId: record.document ? String(record.document) : null,
                documentName: docDef?.name || "Unknown document",
                uploadId: upload.uploadId || null, expiryDate: upload.expiryDate,
                daysLeft: Math.ceil((expiry - now) / 86400000),
                isExpired: expiry < now, status: upload.status, source: "groupDocuments",
              });
            }
          }
        }
      }
    };

    processLegacy(clients, "Client");
    processLegacy(practices, "Practice");
    processGroupDocs(clients, "Client");
    processGroupDocs(practices, "Practice");
    alerts.sort((a, b) => a.daysLeft - b.daysLeft);

    res.json({
      alerts,
      summary: { total: alerts.length, expired: alerts.filter(a => a.isExpired).length, soon: alerts.filter(a => !a.isExpired).length },
    });
  } catch (err) {
    console.error("getExpiringDocs ERROR:", err.message);
    res.status(500).json({ message: "Failed to get expiring documents" });
  }
};

export const runExpiryCheck = async (req, res) => {
  try {
    const now      = new Date();
    let   notified = 0;

    const [clients, practices] = await Promise.all([
      query(`SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'isActive')::boolean, true) = true`, [CLIENT_MODEL]).then(r => mapRows(r.rows)),
      query(`SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'isActive')::boolean, true) = true`, [PRACTICE_MODEL]).then(r => mapRows(r.rows)),
    ]);

    const allDocDefs = await query(
      `SELECT id, data FROM app_records WHERE model = $1 AND COALESCE((data->>'active')::boolean, true) = true`,
      [COMP_DOC_MODEL]
    ).then(r => mapRows(r.rows));
    const docDefMap = new Map(allDocDefs.map(d => [String(d._id), d]));

    const processEntity = async (entity, model, docTypes) => {
      const docs    = entity.complianceDocs || {};
      const emails  = [];
      const patch   = {};

      for (const d of docTypes) {
        const meta = docs[d.key];
        if (!meta?.expiryDate) continue;
        const expiry   = new Date(meta.expiryDate);
        const daysLeft = Math.ceil((expiry - now) / 86400000);
        if (expiry < now && meta.status === "verified") {
          const updatedDocs = { ...docs, [d.key]: { ...meta, status: "pending" } };
          patch.complianceDocs = updatedDocs;
          patch[d.key] = false;
          emails.push({ label: d.label, daysLeft, expired: true });
        } else if (daysLeft <= 30 && daysLeft > 0) {
          emails.push({ label: d.label, daysLeft, expired: false });
        }
      }

      const groupDocs        = Array.isArray(entity.groupDocuments) ? entity.groupDocuments : [];
      const updatedGroupDocs = groupDocs.map(record => {
        const docDef       = docDefMap.get(String(record.document)) || null;
        const reminderDays = docDef?.defaultReminderDays ?? 30;
        const uploads      = getRecordUploads(record, docDef).map(upload => {
          if (!upload.expiryDate) return upload;
          const expiry   = new Date(upload.expiryDate);
          const daysLeft = Math.ceil((expiry - now) / 86400000);
          if (expiry < now && upload.status !== "expired") {
            emails.push({ label: docDef?.name || "Document", daysLeft, expired: true });
            return { ...upload, status: "expired" };
          }
          if (daysLeft <= reminderDays && daysLeft > 0)
            emails.push({ label: docDef?.name || "Document", daysLeft, expired: false });
          return upload;
        });
        const latest = uploads[0] || null;
        return { ...record, uploads, status: latest?.status || record.status };
      });

      if (JSON.stringify(updatedGroupDocs) !== JSON.stringify(groupDocs))
        patch.groupDocuments = updatedGroupDocs;

      if (Object.keys(patch).length) await updateRecord(model, entity._id, patch);

      if (emails.length) {
        const emailTarget =
          (entity.contacts || []).find(c => c.email)?.email ||
          (entity.financeContacts || []).find(c => c.email)?.email || null;

        if (emailTarget && process.env.EMAIL_FROM) {
          const rows = emails.map(e =>
            `<tr><td>${e.label}</td><td style="color:${e.expired ? "#dc2626" : "#d97706"}">${e.expired ? "EXPIRED" : `${e.daysLeft} days`}</td></tr>`
          ).join("");
          await transporter.sendMail({
            from: process.env.EMAIL_FROM, to: emailTarget,
            subject: `Compliance Alert: Documents Requiring Attention — ${entity.name}`,
            html: `<p>Documents for <strong>${entity.name}</strong> require attention:</p>
              <table border="1" cellpadding="6" style="border-collapse:collapse;font-size:14px">
                <tr><th>Document</th><th>Status</th></tr>${rows}
              </table>
              <p>Please log in to the CPS portal to take action.</p>`,
          }).catch(e => console.warn("Expiry email failed:", e.message));
          notified++;
        }
      }
    };

    for (const c of clients)   await processEntity(c, CLIENT_MODEL,   CLIENT_DOC_TYPES);
    for (const p of practices) await processEntity(p, PRACTICE_MODEL, PRACTICE_DOC_TYPES);

    res.json({ message: "Expiry check complete", notified });
  } catch (err) {
    console.error("runExpiryCheck ERROR:", err.message);
    res.status(500).json({ message: "Failed to run expiry check" });
  }
};