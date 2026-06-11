/**
 * controllers/clinicianComplianceController.js — Module 3
 *
 * Per-clinician compliance documents (DBS, indemnity, GPhC, ID, RTW, etc.)
 *
 * UPDATED:
 *   + getClinicianComplianceGroups — GET /:id/compliance-groups
 *     Returns assigned document groups with per-doc upload status
 *     (assigned count, uploaded count, remaining count)
 *   + assignComplianceGroups       — PUT /:id/compliance-groups
 *     Assign one or more DocumentGroups to a clinician
 *
 * Endpoints (mounted under /api/clinicians):
 *   GET    /:id/compliance                       → list docs + progress
 *   PATCH  /:id/compliance/:docId                → upsert (with optional file upload)
 *   POST   /:id/compliance/:docId/approve        → admin approves
 *   POST   /:id/compliance/:docId/reject         → admin rejects with reason
 *   GET    /:id/compliance-groups                → groups with doc status (NEW)
 *   PUT    /:id/compliance-groups                → assign groups (NEW)
 */

import ClinicianComplianceDoc    from "../models/ClinicianComplianceDoc.js";
import Clinician                 from "../models/Clinician.js";
import DocumentGroup             from "../models/DocumentGroup.js";
import { logAudit }              from "../middleware/auditLogger.js";
import { normalizeId }           from "../lib/ids.js";
import { assertClinicianAccess } from "../lib/clinicianAccess.js";
import { uploadBufferToStorage } from "../lib/supabase.js";

/* ─── helpers */
const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

const isExpired = (doc) => {
  if (!doc?.expiryDate) return false;
  return new Date(doc.expiryDate).getTime() < Date.now();
};

const computeStatusForRead = (doc) => {
  if (!doc) return doc;
  if (doc.status === "approved" && isExpired(doc)) {
    return { ...doc, status: "expired", _expiredAuto: true };
  }
  return doc;
};

const calcProgress = (docs) => {
  const mandatory = docs.filter((d) => d.mandatory !== false);
  if (mandatory.length === 0) return 100;
  const ok = mandatory.filter((d) => d.status === "approved" && !isExpired(d)).length;
  return Math.round((ok / mandatory.length) * 100);
};

/* ─── LIST */
export const getCompliance = async (req, res, next) => {
  try {
    const id = await assertClinicianAccess(req, req.params.id);

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const rows = await ClinicianComplianceDoc.find({ clinician: id }).lean();
    const docs = rows.map(computeStatusForRead);

    docs.sort((a, b) => String(a.docName || "").localeCompare(String(b.docName || "")));

    res.json({
      docs,
      progress: calcProgress(docs),
      progressPct: calcProgress(docs),
      total: docs.length,
      expiringSoon: docs.filter((d) => {
        if (!d.expiryDate) return false;
        const ms = new Date(d.expiryDate).getTime() - Date.now();
        return ms > 0 && ms < 30 * 24 * 60 * 60 * 1000;
      }).length,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── UPSERT (with optional file upload) */
export const upsertDoc = async (req, res, next) => {
  try {
    const id    = toId(req.params.id);
    const docId = req.params.docId;
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    let existing = null;
    if (docId && docId !== "new") {
      existing = await ClinicianComplianceDoc.findById(docId).lean();
      if (existing && String(existing.clinician) !== String(id)) {
        return res.status(403).json({ message: "Doc does not belong to this clinician" });
      }
    }

    // Optional file upload (multer.single("file"))
    let fileMeta = null;
    if (req.file?.buffer) {
      try {
        fileMeta = await uploadBufferToStorage({
          buffer:      req.file.buffer,
          contentType: req.file.mimetype,
          fileName:    req.file.originalname,
        });
      } catch (uploadErr) {
        return res.status(500).json({
          message: "File upload failed",
          error:   uploadErr.message,
        });
      }
    }

    const body = { ...req.body };

    const docData = {
      clinician: id,
      docName:    body.docName    ?? existing?.docName    ?? "",
      docKey:     body.docKey     ?? existing?.docKey     ?? "",
      mandatory:  typeof body.mandatory !== "undefined"
        ? (body.mandatory === true || body.mandatory === "true")
        : (existing?.mandatory ?? true),
      expiryDate: body.expiryDate ?? existing?.expiryDate ?? null,
      notes:      body.notes      ?? existing?.notes      ?? "",
      uploadedBy: body.uploadedBy ?? existing?.uploadedBy ?? "clinician",
    };

    if (fileMeta) {
      docData.fileUrl     = fileMeta.publicUrl;
      docData.fileName    = req.file.originalname;
      docData.storagePath = fileMeta.path;
      docData.bucket      = fileMeta.bucket;
      docData.uploadedAt  = new Date().toISOString();
      docData.status      = "uploaded";
    } else if (existing) {
      docData.fileUrl     = existing.fileUrl;
      docData.fileName    = existing.fileName;
      docData.storagePath = existing.storagePath;
      docData.bucket      = existing.bucket;
      docData.uploadedAt  = existing.uploadedAt;
      docData.status      = body.status || existing.status || "missing";
    } else {
      docData.status = body.status || "missing";
    }

    let saved;
    if (existing) {
      saved = await ClinicianComplianceDoc.findByIdAndUpdate(existing._id, docData, { new: true });
    } else {
      saved = await ClinicianComplianceDoc.create(docData);
    }

    await logAudit(req, existing ? "UPDATE_CLINICIAN_COMPLIANCE_DOC" : "CREATE_CLINICIAN_COMPLIANCE_DOC", "ClinicianComplianceDoc", {
      resourceId: saved._id,
      detail: `${existing ? "Updated" : "Added"} compliance doc "${saved.docName}" for clinician ${id}${fileMeta ? " (file uploaded)" : ""}`,
      before: safeJson(existing),
      after:  safeJson(saved),
    });

    res.json({ doc: saved });
  } catch (err) {
    next(err);
  }
};

/* ─── APPROVE */
export const approveDoc = async (req, res, next) => {
  try {
    const id    = toId(req.params.id);
    const docId = toId(req.params.docId);
    if (!id || !docId) return res.status(400).json({ message: "Invalid id" });

    const existing = await ClinicianComplianceDoc.findById(docId).lean();
    if (!existing) return res.status(404).json({ message: "Doc not found" });
    if (String(existing.clinician) !== String(id))
      return res.status(403).json({ message: "Doc does not belong to this clinician" });

    const updated = await ClinicianComplianceDoc.findByIdAndUpdate(
      docId,
      {
        status:       "approved",
        approvedBy:   req.user?._id || null,
        approvedAt:   new Date().toISOString(),
        rejectedBy:   null,
        rejectedAt:   null,
        rejectReason: "",
      },
      { new: true }
    );

    await logAudit(req, "APPROVE_CLINICIAN_COMPLIANCE_DOC", "ClinicianComplianceDoc", {
      resourceId: docId,
      detail: `Approved "${existing.docName}" for clinician ${id}`,
      before: { status: existing.status },
      after:  { status: "approved" },
    });

    res.json({ doc: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── REJECT */
export const rejectDoc = async (req, res, next) => {
  try {
    const id    = toId(req.params.id);
    const docId = toId(req.params.docId);
    if (!id || !docId) return res.status(400).json({ message: "Invalid id" });

    const existing = await ClinicianComplianceDoc.findById(docId).lean();
    if (!existing) return res.status(404).json({ message: "Doc not found" });
    if (String(existing.clinician) !== String(id))
      return res.status(403).json({ message: "Doc does not belong to this clinician" });

    const reason = String(req.body?.reason || "").trim();

    const updated = await ClinicianComplianceDoc.findByIdAndUpdate(
      docId,
      {
        status:       "rejected",
        rejectedBy:   req.user?._id || null,
        rejectedAt:   new Date().toISOString(),
        rejectReason: reason,
        approvedBy:   null,
        approvedAt:   null,
      },
      { new: true }
    );

    await logAudit(req, "REJECT_CLINICIAN_COMPLIANCE_DOC", "ClinicianComplianceDoc", {
      resourceId: docId,
      detail: `Rejected "${existing.docName}" for clinician ${id}${reason ? ` — reason: ${reason}` : ""}`,
      before: { status: existing.status },
      after:  { status: "rejected", rejectReason: reason },
    });

    res.json({ doc: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── GET COMPLIANCE GROUPS (NEW) ─────────────────────────────────────────
   GET /api/clinicians/:id/compliance-groups
   Returns all assigned document groups with per-doc upload status.
   Response shape:
   {
     groups: [
       {
         _id, name,
         docs: [{ _id, name, mandatory, expirable, status, fileUrl, uploadedAt, expiryDate, docId }],
         summary: { total, uploaded, missing, remaining }
       }
     ],
     totalGroups, totalDocs, totalUploaded, totalMissing
   }
─────────────────────────────────────────────────────────────────────────── */
export const getClinicianComplianceGroups = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    // Assigned group IDs on the clinician record
    const assignedGroupIds = clinician.complianceGroups || [];

    if (assignedGroupIds.length === 0) {
      return res.json({
        groups:        [],
        totalGroups:   0,
        totalDocs:     0,
        totalUploaded: 0,
        totalMissing:  0,
      });
    }

    // Fetch the groups with their documents populated
    const groups = await DocumentGroup.find({
      _id:    { $in: assignedGroupIds },
      active: { $ne: false },
    })
      .populate({
        path:   "documents",
        select: "name mandatory expirable active defaultExpiryDays clinicianCanUpload visibleToClinician",
        match:  { active: { $ne: false } },
      })
      .lean();

    // All existing compliance docs for this clinician
    const existingDocs = await ClinicianComplianceDoc.find({ clinician: id }).lean();

    // Build lookup: docKey or docName → compliance doc record
    const docByDocId  = new Map(existingDocs.map(d => [String(d.docKey || ""), d]));
    const docByName   = new Map(existingDocs.map(d => [String(d.docName || "").toLowerCase(), d]));

    const result = groups.map((group) => {
      const docs = (group.documents || [])
        .filter(doc => doc && doc.active !== false)
        .map((doc) => {
          // Try matching by doc ID first, then by name
          const existing =
            docByDocId.get(String(doc._id)) ||
            docByName.get(String(doc.name || "").toLowerCase()) ||
            null;

          const rawStatus  = existing?.status || "missing";
          const docExpired = existing ? isExpired(existing) : false;
          const status     = rawStatus === "approved" && docExpired ? "expired" : rawStatus;

          return {
            _id:        doc._id,
            name:       doc.name,
            mandatory:  doc.mandatory ?? true,
            expirable:  doc.expirable ?? false,
            clinicianCanUpload: doc.clinicianCanUpload ?? false,
            visibleToClinician: doc.visibleToClinician !== false,
            status,
            fileUrl:    existing?.fileUrl    || null,
            fileName:   existing?.fileName   || null,
            uploadedAt: existing?.uploadedAt || null,
            expiryDate: existing?.expiryDate || null,
            rejectReason: existing?.rejectReason || null,
            // docId used by frontend to upsert the correct record
            docId: existing?._id ? String(existing._id) : null,
          };
        });

      const total    = docs.length;
      const uploaded = docs.filter(d => d.status === "approved" || d.status === "uploaded").length;
      const missing  = docs.filter(d => d.status === "missing").length;

      return {
        _id:     group._id,
        name:    group.name,
        docs,
        summary: { total, uploaded, missing, remaining: total - uploaded },
      };
    });

    const totalDocs     = result.reduce((s, g) => s + g.summary.total,    0);
    const totalUploaded = result.reduce((s, g) => s + g.summary.uploaded,  0);
    const totalMissing  = result.reduce((s, g) => s + g.summary.missing,   0);

    res.json({
      groups:      result,
      totalGroups: result.length,
      totalDocs,
      totalUploaded,
      totalMissing,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── ASSIGN COMPLIANCE GROUPS (NEW) ──────────────────────────────────────
   PUT /api/clinicians/:id/compliance-groups
   Body: { groupIds: string[] }
   Assigns document groups to a clinician. Replaces existing assignment.
─────────────────────────────────────────────────────────────────────────── */
export const assignComplianceGroups = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const { groupIds } = req.body;
    if (!Array.isArray(groupIds))
      return res.status(400).json({ message: "groupIds must be an array" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const previousGroups = clinician.complianceGroups || [];

    // Validate that all groupIds actually exist
    if (groupIds.length > 0) {
      const validGroups = await DocumentGroup.find({ _id: { $in: groupIds } }).select("_id").lean();
      if (validGroups.length !== groupIds.length) {
        return res.status(400).json({ message: "One or more group IDs are invalid" });
      }
    }

    await Clinician.findByIdAndUpdate(id, { complianceGroups: groupIds });

    await logAudit(req, "ASSIGN_COMPLIANCE_GROUPS", "Clinician", {
      resourceId: id,
      detail:     `Assigned ${groupIds.length} compliance group(s) to clinician`,
      before:     { complianceGroups: previousGroups },
      after:      { complianceGroups: groupIds },
    });

    res.json({
      success:  true,
      message:  `${groupIds.length} compliance group(s) assigned`,
      groupIds,
    });
  } catch (err) {
    next(err);
  }
};