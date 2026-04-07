/**
 * complianceController.js
 *
 * Handles all compliance document operations:
 * - Upload / update document metadata
 * - Approve / Reject documents
 * - Get compliance status
 * - Expiry alerts
 * - Cron-ready expiry check
 */

import PCN            from "../models/PCN.js";
import Practice       from "../models/Practice.js";
import nodemailer     from "nodemailer";

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
  throw new Error("Invalid entityType");
}

function computeDocumentStatus(record, docDef) {
  if (!record?.fileUrl) return "pending";
  if (docDef?.expirable && record.expiryDate && new Date(record.expiryDate) < new Date()) return "expired";
  return record.status === "expired" ? "expired" : "uploaded";
}

async function getEntityDocumentContext(entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  const Model = getModel(normalizedType);
  const entity = await Model.findById(entityId)
    .populate({
      path: "complianceGroup",
      select: "name active displayOrder documents",
      populate: {
        path: "documents",
        select: "name displayOrder mandatory expirable active defaultExpiryDays defaultReminderDays",
      },
    })
    .lean();

  if (!entity) return { normalizedType, entity: null, documents: [] };

  const groupDocs = (entity.complianceGroup?.documents || [])
    .filter((doc) => doc && doc.active !== false)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));

  return { normalizedType, entity, documents: groupDocs };
}

function buildEntityDocumentsPayload(entity, documents) {
  const recordMap = new Map(
    (entity.groupDocuments || []).map((record) => [String(record.document), record])
  );

  const rows = documents.map((doc) => {
    const record = recordMap.get(String(doc._id)) || null;
    const status = computeDocumentStatus(record, doc);
    return {
      documentId: String(doc._id),
      name: doc.name,
      mandatory: !!doc.mandatory,
      expirable: !!doc.expirable,
      defaultExpiryDays: doc.defaultExpiryDays ?? null,
      defaultReminderDays: doc.defaultReminderDays ?? null,
      fileName: record?.fileName || "",
      fileUrl: record?.fileUrl || "",
      mimeType: record?.mimeType || "",
      fileSize: record?.fileSize || 0,
      uploadedAt: record?.uploadedAt || null,
      uploadedBy: record?.uploadedBy || null,
      status,
      expiryDate: record?.expiryDate || null,
      renewalDate: record?.renewalDate || null,
      notes: record?.notes || "",
    };
  });

  return {
    complianceGroup: entity.complianceGroup
      ? {
          _id: entity.complianceGroup._id,
          name: entity.complianceGroup.name,
          active: entity.complianceGroup.active,
          displayOrder: entity.complianceGroup.displayOrder,
        }
      : null,
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
    const { normalizedType, entity, documents } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );

    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    res.json({
      entityType: normalizedType,
      entityId: entity._id,
      entityName: entity.name,
      ...buildEntityDocumentsPayload(entity, documents),
    });
  } catch (err) {
    console.error("getEntityDocuments ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
};

export const upsertEntityDocument = async (req, res) => {
  try {
    const { normalizedType, entity, documents } = await getEntityDocumentContext(
      req.params.entityType,
      req.params.entityId
    );
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });
    if (!entity.complianceGroup?._id) {
      return res.status(400).json({ message: "Select a compliance group before uploading documents" });
    }

    const documentId = String(req.params.documentId);
    const docDef = documents.find((doc) => String(doc._id) === documentId);
    if (!docDef) return res.status(404).json({ message: "Document is not part of the selected compliance group" });

    const {
      fileName,
      fileUrl,
      mimeType,
      fileSize,
      expiryDate,
      renewalDate,
      notes,
      clearFile,
    } = req.body;

    const records = [...(entity.groupDocuments || [])];
    const recordIndex = records.findIndex((record) => String(record.document) === documentId);
    const existing = recordIndex >= 0 ? records[recordIndex] : { document: req.params.documentId };

    const nextRecord = {
      ...existing,
      document: req.params.documentId,
      fileName: fileName !== undefined ? fileName : existing.fileName || "",
      fileUrl: fileUrl !== undefined ? fileUrl : existing.fileUrl || "",
      mimeType: mimeType !== undefined ? mimeType : existing.mimeType || "",
      fileSize: fileSize !== undefined ? fileSize : existing.fileSize || 0,
      expiryDate: expiryDate !== undefined ? (expiryDate ? new Date(expiryDate) : null) : existing.expiryDate || null,
      renewalDate: renewalDate !== undefined ? (renewalDate ? new Date(renewalDate) : null) : existing.renewalDate || null,
      notes: notes !== undefined ? notes : existing.notes || "",
      uploadedBy: existing.uploadedBy || null,
      uploadedAt: existing.uploadedAt || null,
      lastUpdatedBy: req.user._id,
    };

    if (clearFile) {
      nextRecord.fileName = "";
      nextRecord.fileUrl = "";
      nextRecord.mimeType = "";
      nextRecord.fileSize = 0;
      nextRecord.uploadedAt = null;
      nextRecord.uploadedBy = null;
      nextRecord.status = "pending";
    } else if (fileUrl) {
      nextRecord.uploadedAt = new Date();
      nextRecord.uploadedBy = req.user._id;
      if (!nextRecord.expiryDate && docDef.expirable && docDef.defaultExpiryDays) {
        nextRecord.expiryDate = new Date(Date.now() + docDef.defaultExpiryDays * 24 * 60 * 60 * 1000);
      }
      nextRecord.status = computeDocumentStatus(nextRecord, docDef);
    } else {
      nextRecord.status = computeDocumentStatus(nextRecord, docDef);
    }

    if (recordIndex >= 0) records[recordIndex] = nextRecord;
    else records.push(nextRecord);

    const Model = getModel(normalizedType);
    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $set: { groupDocuments: records } },
      { new: true, runValidators: false }
    );

    const refreshed = await getEntityDocumentContext(req.params.entityType, req.params.entityId);
    res.json({
      message: "Document updated",
      entityType: normalizedType,
      entityId: req.params.entityId,
      entityName: refreshed.entity?.name,
      ...buildEntityDocumentsPayload(refreshed.entity, refreshed.documents),
    });
  } catch (err) {
    console.error("upsertEntityDocument ERROR:", err.message, err.stack);
    res.status(500).json({ message: "Failed to update document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   GET /api/clients/:entityType/:entityId/compliance/status
   Returns a full compliance status summary
──────────────────────────────────────────────────────────────────── */
export const getComplianceStatus = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const Model    = getModel(entityType);
    const docTypes = getDocTypes(entityType);

    const entity = await Model.findById(entityId).lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

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
    res.status(500).json({ message: "Failed to get compliance status" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   PATCH /api/clients/:entityType/:entityId/compliance/:docKey
   Upload or update a compliance document's metadata
──────────────────────────────────────────────────────────────────── */
export const upsertComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const Model = getModel(entityType);

    const entity = await Model.findById(entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const existing = entity.complianceDocs?.[docKey] || {};
    const {
      fileName, fileUrl, mimeType, fileSize,
      expiryDate, renewalDate, notes, status
    } = req.body;

    // Build new meta — preserve existing fields not in body
    const newMeta = {
      ...existing,
      ...(fileName   !== undefined && { fileName }),
      ...(fileUrl    !== undefined && { fileUrl }),
      ...(mimeType   !== undefined && { mimeType }),
      ...(fileSize   !== undefined && { fileSize }),
      ...(notes      !== undefined && { notes }),
      ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
      ...(renewalDate!== undefined && { renewalDate: renewalDate ? new Date(renewalDate) : null }),
      // If new file uploaded, reset to pending
      ...(fileUrl && fileUrl !== existing.fileUrl && {
        status:     "pending",
        uploadedAt: new Date(),
        version:    (existing.version || 0) + 1,
        // Archive previous version
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
      // Allow direct status set if no new file
      ...(!fileUrl && status !== undefined && { status }),
    };

    // Also toggle the boolean flag if verified
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
    res.status(500).json({ message: "Failed to update compliance document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/clients/:entityType/:entityId/compliance/:docKey/approve
──────────────────────────────────────────────────────────────────── */
export const approveComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const Model = getModel(entityType);

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

    if (!updated) return res.status(404).json({ message: `${entityType} not found` });

    res.json({ message: "Document approved", complianceDocs: updated.complianceDocs });
  } catch (err) {
    console.error("approveComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to approve document" });
  }
};

/* ────────────────────────────────────────────────────────────────────
   POST /api/clients/:entityType/:entityId/compliance/:docKey/reject
──────────────────────────────────────────────────────────────────── */
export const rejectComplianceDoc = async (req, res) => {
  try {
    const { entityType, entityId, docKey } = req.params;
    const { reason } = req.body;

    if (!reason?.trim()) return res.status(400).json({ message: "Rejection reason is required" });

    const Model = getModel(entityType);

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

    if (!updated) return res.status(404).json({ message: `${entityType} not found` });

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
    res.status(500).json({ message: "Failed to reject document" });
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
