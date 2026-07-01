/**
 * clientController.js  —  CPS Client Management
 *
 * UPDATED (Jun 2026 — Rate & Contract History):   NEW
 *   — trackFieldChanges() helper: detects real changes to hourlyRate,
 *     contractStartDate, contractRenewalDate, contractExpiryDate and
 *     appends entries to PCN.hourlyRateHistory
 *   — updatePCN: now calls trackFieldChanges() before saving, so every
 *     rate/contract-date change is automatically logged
 *   — getPCNRateHistory: GET /pcn/:id/rate-history — full history for one client
 *   — getAllPCNRateSummary: GET /pcn/rate-history/summary — all clients,
 *     current values + last change + change count (powers the list page)
 *
 * (All previous history/comments preserved from original file — see
 *  earlier versions for the Apr/Jun 2026 changelog.)
 */

import { Request, Response, NextFunction } from "express";
import ICB            from "../models/ICB.js";
import Federation     from "../models/Federation.js";
import PCN            from "../models/PCN.js";
import Practice       from "../models/Practice.js";
import ContactHistory from "../models/ContactHistory.js";
import User           from "../models/User.js";
import nodemailer     from "nodemailer";
import crypto         from "crypto";
import { logAudit }   from "../middleware/auditLogger.js";
import { normalizeId } from "../lib/ids.js";
import { uploadBufferToStorage } from "../lib/supabase.js";

/* ── Helpers ─────────────────────────────────────────────────────── */
// @ts-ignore
const toObjectId = (id) => normalizeId(id);

// @ts-ignore
const validateObjectIdOr400 = (id, label = "id") => {
  const objectId = toObjectId(id);
  if (!objectId) {
    const error = new Error(`Invalid ${label}`);
    // @ts-ignore
    error.statusCode = 400;
    throw error;
  }
  return objectId;
};

// @ts-ignore
const safeJson = (value) => JSON.parse(JSON.stringify(value ?? null));

const formatComplianceGroupDetail = (beforeGroups = [], afterGroups = []) => {
  const beforeText = beforeGroups.length ? beforeGroups.join(", ") : "none";
  const afterText  = afterGroups.length  ? afterGroups.join(", ")  : "none";
  return `Compliance groups changed from [${beforeText}] to [${afterText}]`;
};

/* ══════════════════════════════════════════════════════════════════
     NEW — RATE & CONTRACT HISTORY HELPER
   Detects real changes to hourlyRate / contract dates between the
   pre-update PCN doc (`existing`) and the incoming update (`payload`),
   and mutates `payload` to append new entries to hourlyRateHistory.
   MUST run BEFORE PCN.findByIdAndUpdate(...) inside updatePCN.
══════════════════════════════════════════════════════════════════ */
const TRACKED_FIELDS = [
  { key: "hourlyRate",           label: "Hourly Rate"    },
  { key: "contractStartDate",    label: "Contract Start" },
  { key: "contractRenewalDate",  label: "Renewal Date"   },
  { key: "contractExpiryDate",   label: "Expiry Date"    },
];

// @ts-ignore
const trackFieldChanges = (existing, payload, userId) => {
  const newEntries = [];

  for (const { key, label } of TRACKED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;

    const oldVal = existing[key] ?? null;
    const newVal = payload[key] ?? null;

    // @ts-ignore
    const normalize = (v) => {
      if (v === null || v === undefined || v === "") return null;
      if (key === "hourlyRate") return Number(v);
      return new Date(v).toISOString().split("T")[0];
    };

    const oldNorm = normalize(oldVal);
    const newNorm = normalize(newVal);

    if (oldNorm === newNorm) continue;

    newEntries.push({
      field:      key,
      fieldLabel: label,
      oldValue:   oldVal,
      newValue:   newVal,
      changedAt:  new Date(),
      changedBy:  userId,
    });
  }

  if (newEntries.length > 0) {
    payload.hourlyRateHistory = [
      ...(existing.hourlyRateHistory || []),
      ...newEntries,
    ];
  }

  return newEntries;
};

const normalizeEntityType = (entityType = "") => {
  const normalized = String(entityType).trim().toLowerCase();
  if (normalized === "pcn")        return "PCN";
  if (normalized === "practice")   return "Practice";
  if (normalized === "federation") return "Federation";
  if (normalized === "icb")        return "ICB";
  const error = new Error("Invalid entityType");
  // @ts-ignore
  error.statusCode = 400;
  throw error;
};

// @ts-ignore
const getEntityModelByType = (entityType) => {
  if (entityType === "PCN")        return PCN;
  if (entityType === "Practice")   return Practice;
  if (entityType === "Federation") return Federation;
  if (entityType === "ICB")        return ICB;
  const error = new Error("Invalid entityType");
  // @ts-ignore
  error.statusCode = 400;
  throw error;
};

// @ts-ignore
const getPCNOrPracticeModel = (entityType) => {
  if (entityType === "PCN")      return PCN;
  if (entityType === "Practice") return Practice;
  const error = new Error("entityType must be PCN or Practice for this endpoint");
  // @ts-ignore
  error.statusCode = 400;
  throw error;
};

const normalizeComplianceGroup = (payload = {}) => {
  const next = { ...payload };
  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroups")) {
    const complianceGroups = Array.from(
      new Set(
        // @ts-ignore
        (Array.isArray(payload.complianceGroups) ? payload.complianceGroups : [payload.complianceGroups])
          // @ts-ignore
          .map((v) => String(v || "").trim()).filter(Boolean)
      )
    );
    // @ts-ignore
    next.complianceGroups = complianceGroups;
    // @ts-ignore
    next.complianceGroup  = complianceGroups;
    return next;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
    // @ts-ignore
    const arr = Array.isArray(payload.complianceGroup) ? payload.complianceGroup : [payload.complianceGroup];
    const complianceGroups = Array.from(new Set(arr.map((v: any) => String(v || "").trim()).filter(Boolean)));
    // @ts-ignore
    next.complianceGroup  = complianceGroups;
    // @ts-ignore
    next.complianceGroups = complianceGroups;
  }
  return next;
};

/* ── Email transport ─────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// @ts-ignore
const recordView = async (Model, id, userId) => {
  try { await Model.findByIdAndUpdate(id, { $push: { viewedBy: { user: userId, viewedAt: new Date() } } }); }
  catch (_) {}
};

/* ══════════════════════════════════════════════════════════════════
   REPORTING ARCHIVE
══════════════════════════════════════════════════════════════════ */

export const getReportingArchive = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const { month, year } = req.query;

    const entity = await Model.findById(entityId)
      .select("name reportingArchive")
      .lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    let archive = Array.isArray(entity.reportingArchive) ? entity.reportingArchive : [];

    // @ts-ignore
    if (month) archive = archive.filter((r) => String(r.month) === String(month));
    // @ts-ignore
    if (year)  archive = archive.filter((r) => String(r.year)  === String(year));

    archive = [...archive].sort((a, b) => {
      if (b.year !== a.year) return (b.year || 0) - (a.year || 0);
      return (b.month || 0) - (a.month || 0);
    });

    res.json({ archive, total: archive.length, entityName: entity.name });
  } catch (err) {
    // @ts-ignore
    console.error("getReportingArchive ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch reporting archive" });
  }
};

export const addToReportingArchive = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const entity = await Model.findById(entityId).lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const { month, year, notes, starred } = req.body;
    if (!month || !year)
      return res.status(400).json({ message: "month and year are required" });

    if (!req.file)
      return res.status(400).json({ message: "A report file is required" });

    const uploaded = await uploadBufferToStorage({
      buffer:      req.file.buffer,
      contentType: req.file.mimetype || "application/octet-stream",
      fileName:    req.file.originalname || "report.pdf",
    });

    const reportEntry = {
      month:      Number(month),
      year:       Number(year),
      reportUrl:  uploaded.publicUrl,
      fileName:   req.file.originalname || "report.pdf",
      uploadedAt: new Date(),
      // @ts-ignore
      uploadedBy: req.user._id,
      notes:      notes?.trim() || "",
      starred:    starred === "true" || starred === true,
    };

    await Model.findByIdAndUpdate(
      entityId,
      { $push: { reportingArchive: reportEntry } },
      { new: true, runValidators: false }
    );

    await ContactHistory.create({
      entityType,
      entityId: entityId,
      type:     "report",
      subject:  `Monthly Report — ${String(month).padStart(2, "0")}/${year}`,
      notes:    notes?.trim() || "",
      date:     new Date(),
      time:     new Date().toTimeString().slice(0, 5),
      starred:  true,
      // @ts-ignore
      createdBy: req.user._id,
    });

    await logAudit(req, "REPORTING_ARCHIVE_ADD", entityType, {
      resourceId: entityId,
      detail:     `Report uploaded: ${reportEntry.fileName} (${month}/${year})`,
      after:      { entityType, entityId, month, year, fileName: reportEntry.fileName },
    });

    res.status(201).json({ message: "Report added to archive", report: reportEntry });
  } catch (err) {
    // @ts-ignore
    console.error("addToReportingArchive ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to add report" });
  }
};

export const deleteFromReportingArchive = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);
    const { reportId } = req.params;

    const entity = await Model.findById(entityId).lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const before = (entity.reportingArchive || []).length;
    await Model.findByIdAndUpdate(
      entityId,
      { $pull: { reportingArchive: { _id: reportId } } },
      { new: true, runValidators: false }
    );
    const after = await Model.findById(entityId).select("reportingArchive").lean();
    if ((after?.reportingArchive || []).length === before)
      return res.status(404).json({ message: "Report not found in archive" });

    await logAudit(req, "REPORTING_ARCHIVE_DELETE", entityType, {
      resourceId: entityId,
      detail: `Report removed from archive (reportId: ${reportId})`,
      after: { entityType, entityId, reportId },
    });

    res.json({ message: "Report deleted from archive" });
  } catch (err) {
    // @ts-ignore
    console.error("deleteFromReportingArchive ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete report" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   DECISION MAKERS
══════════════════════════════════════════════════════════════════ */

export const getDecisionMakers = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const entity = await Model.findById(entityId)
      .select("name decisionMakers")
      .lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    res.json({ decisionMakers: entity.decisionMakers || [], entityName: entity.name });
  } catch (err) {
    // @ts-ignore
    console.error("getDecisionMakers ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch decision makers" });
  }
};

export const updateDecisionMakers = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const { decisionMakers } = req.body;
    if (!Array.isArray(decisionMakers))
      return res.status(400).json({ message: "decisionMakers must be an array" });

    for (const dm of decisionMakers) {
      if (!dm.name?.trim() || !dm.email?.trim())
        return res.status(400).json({ message: "Each decision maker requires at minimum name and email" });
    }

    const entity = await Model.findByIdAndUpdate(
      entityId,
      { decisionMakers },
      { new: true, runValidators: true }
    ).select("name decisionMakers").lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    await logAudit(req, "UPDATE_DECISION_MAKERS", entityType, {
      resourceId: entityId,
      detail:     `Decision makers updated for ${entityType} (${decisionMakers.length} entries)`,
      after:      { entityType, entityId, count: decisionMakers.length },
    });

    res.json({ decisionMakers: entity.decisionMakers, entityName: entity.name, message: "Decision makers updated" });
  } catch (err) {
    // @ts-ignore
    console.error("updateDecisionMakers ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update decision makers" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   FINANCE CONTACTS
══════════════════════════════════════════════════════════════════ */

export const getFinanceContacts = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const entity = await Model.findById(entityId)
      .select("name financeContacts")
      .lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    res.json({ financeContacts: entity.financeContacts || [], entityName: entity.name });
  } catch (err) {
    // @ts-ignore
    console.error("getFinanceContacts ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch finance contacts" });
  }
};

export const updateFinanceContacts = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const Model      = getPCNOrPracticeModel(entityType);
    const entityId   = validateObjectIdOr400(req.params.entityId, `${entityType} id`);

    const { financeContacts } = req.body;
    if (!Array.isArray(financeContacts))
      return res.status(400).json({ message: "financeContacts must be an array" });

    const entity = await Model.findByIdAndUpdate(
      entityId,
      { financeContacts },
      { new: true, runValidators: true }
    ).select("name financeContacts").lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    await logAudit(req, "UPDATE_FINANCE_CONTACTS", entityType, {
      resourceId: entityId,
      detail:     `Finance contacts updated for ${entityType} (${financeContacts.length} entries)`,
      after:      { entityType, entityId, count: financeContacts.length },
    });

    res.json({ financeContacts: entity.financeContacts, entityName: entity.name, message: "Finance contacts updated" });
  } catch (err) {
    // @ts-ignore
    console.error("updateFinanceContacts ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update finance contacts" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   CLIENT FACING DATA
══════════════════════════════════════════════════════════════════ */

export const getClientFacingData = async (req: Request, res: Response) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("activeClinicians", "name role")
      .select("name clientFacingData monthlyMeetings activeClinicians")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const now = new Date();
    const upcomingMeetings = (pcn.monthlyMeetings || [])
      // @ts-ignore
      .filter((m) => m.date && new Date(m.date) >= now)
      // @ts-ignore
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      clientFacingData:  pcn.clientFacingData  || {},
      upcomingMeetings,
      // @ts-ignore
      clinicians:        (pcn.activeClinicians || []).map((c) => ({ _id: c._id, name: c.name, role: c.role })),
      entityName:        pcn.name,
    });
  } catch (err) {
    // @ts-ignore
    console.error("getClientFacingData ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch client-facing data" });
  }
};

export const updateClientFacingData = async (req: Request, res: Response) => {
  try {
    const { showMonthlyMeetings, showClinicianMeetings, publicNotes } = req.body;

    const pcn = await PCN.findByIdAndUpdate(
      req.params.id,
      {
        clientFacingData: {
          ...(showMonthlyMeetings   !== undefined && { showMonthlyMeetings }),
          ...(showClinicianMeetings !== undefined && { showClinicianMeetings }),
          ...(publicNotes           !== undefined && { publicNotes: publicNotes?.trim() || "" }),
          lastUpdated: new Date(),
        },
      },
      { new: true, runValidators: true }
    ).select("name clientFacingData").lean();

    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    await logAudit(req, "UPDATE_CLIENT_FACING", "PCN", {
      // @ts-ignore
      resourceId: req.params.id,
      detail:     `Client-facing data updated for PCN: ${pcn.name}`,
      after:      pcn.clientFacingData,
    });

    res.json({ clientFacingData: pcn.clientFacingData, entityName: pcn.name, message: "Client-facing data updated" });
  } catch (err) {
    // @ts-ignore
    console.error("updateClientFacingData ERROR:", err.message);
    res.status(500).json({ message: "Failed to update client-facing data" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   HIERARCHY
══════════════════════════════════════════════════════════════════ */
export const getHierarchy = async (req: Request, res: Response) => {
  try {
    const [icbs, federationsRaw, pcnsRaw, practices] = await Promise.all([
      ICB.find({ isActive: true }).sort({ name: 1 }).lean(),
      Federation.find({ isActive: true }).sort({ name: 1 }).lean(),
      PCN.find({ isActive: true }).sort({ name: 1 }).lean(),
      Practice.find({ isActive: true })
        .select("name odsCode pcn isActive contractType fte")
        .sort({ name: 1 }).lean(),
    ]);

    const fedMapById   = {};
    const fedMapByName = {};
    for (const f of federationsRaw) {
      // @ts-ignore
      fedMapById[String(f._id)]                     = f;
      // @ts-ignore
      fedMapByName[f.name.trim().toLowerCase()]     = f;
    }

    const practicesByPCN = {};
    for (const pr of practices) {
      const key = String(pr.pcn);
      // @ts-ignore
      if (!practicesByPCN[key]) practicesByPCN[key] = [];
      // @ts-ignore
      practicesByPCN[key].push(pr);
    }

    const pcnsByICB = {};
    for (const pcn of pcnsRaw) {
      const icbKey = String(pcn.icb?._id || pcn.icb);
      if (!icbKey || icbKey === "null" || icbKey === "undefined") continue;
      let federation = null;
      const fedField = pcn.federation;
      if (fedField) {
        if (typeof fedField === "string") {
          // @ts-ignore
          federation = /^[0-9a-fA-F]{24}$/.test(fedField) ? fedMapById[fedField] : fedMapByName[fedField.trim().toLowerCase()];
        } else if (fedField._id) {
          // @ts-ignore
          federation = fedMapById[String(fedField._id)];
        }
      }
      // @ts-ignore
      if (!pcnsByICB[icbKey]) pcnsByICB[icbKey] = [];
      // @ts-ignore
      pcnsByICB[icbKey].push({ ...pcn, federation: federation || null, practices: practicesByPCN[String(pcn._id)] || [] });
    }

    // @ts-ignore
    const tree = icbs.map(icb => ({
      ...icb,
      // @ts-ignore
      federations: federationsRaw.filter(f => String(f.icb) === String(icb._id)),
      // @ts-ignore
      pcns:        pcnsByICB[String(icb._id)] || [],
    }));

    res.json({ tree, counts: { icbs: icbs.length, federations: federationsRaw.length, pcns: pcnsRaw.length, practices: practices.length } });
  } catch (err) {
    // @ts-ignore
    console.error("getHierarchy ERROR:", err.message, err.stack);
    // @ts-ignore
    res.status(500).json({ message: "Failed to load hierarchy", detail: err.message });
  }
};

/* ══════════════════════════════════════════════════════════════════
   getPCNs — BUG FIX: federation fallback
══════════════════════════════════════════════════════════════════ */
export const getPCNs = async (req: Request, res: Response) => {
  try {
    const filter = { isActive: true };
    // @ts-ignore
    if (req.query.icb)        filter.icb        = req.query.icb;
    // @ts-ignore
    if (req.query.federation) filter.federation = req.query.federation;

    const pcnsRaw = await PCN.find(filter)
      .populate("icb", "name region code")
      .populate("complianceGroup",  "name")
      .populate("complianceGroups", "name")
      .sort({ name: 1 }).lean();

    const federations = await Federation.find({ isActive: true }).select("name type icb").lean();
    const fedMapById  = {};
    const fedMapByName= {};
    for (const f of federations) {
      // @ts-ignore
      fedMapById[String(f._id)]                 = f;
      // @ts-ignore
      fedMapByName[f.name.trim().toLowerCase()] = f;
    }

    // @ts-ignore
    const pcns = pcnsRaw.map(pcn => {
      let resolvedFederation = null;
      const fedField = pcn.federation;

      if (fedField) {
        if (typeof fedField === "string") {
          resolvedFederation = /^[0-9a-fA-F]{24}$/.test(fedField)
            // @ts-ignore
            ? fedMapById[fedField]
            // @ts-ignore
            : fedMapByName[fedField.trim().toLowerCase()];
        } else if (typeof fedField === "object") {
          const fid = fedField._id || fedField.id;
          // @ts-ignore
          if (fid) resolvedFederation = fedMapById[String(fid)];
        }
      }

      const federation = resolvedFederation || (
        fedField && typeof fedField === "object" && fedField.name ? fedField : null
      );

      return { ...pcn, federation };
    });

    res.json({ pcns });
  } catch (err) {
    // @ts-ignore
    console.error("getPCNs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch PCNs" });
  }
};

/* ── ICB CRUD ─────────────────────────────────────────────────────── */
export const getICBs = async (req: Request, res: Response) => {
  try {
    const icbs = await ICB.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ icbs });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch ICBs" });
  }
};

export const getICBById = async (req: Request, res: Response) => {
  try {
    const icb = await ICB.findById(req.params.id).lean();
    if (!icb) return res.status(404).json({ message: "ICB not found" });

    const [federations, pcnsRaw] = await Promise.all([
      Federation.find({ icb: req.params.id, isActive: true }).select("name type notes").sort({ name: 1 }).lean(),
      PCN.find({ icb: req.params.id, isActive: true })
        .populate("federation", "name type")
        .select("name contractType hourlyRate contractStartDate federation xeroCode")
        .sort({ name: 1 }).lean(),
    ]);

    const practicesByPCN = {};
    if (pcnsRaw.length > 0) {
      // @ts-ignore
      const allPractices = await Practice.find({ pcn: { $in: pcnsRaw.map(p => p._id) }, isActive: true })
        .select("name odsCode fte contractType pcn").lean();
      for (const pr of allPractices) {
        const key = String(pr.pcn);
        // @ts-ignore
        if (!practicesByPCN[key]) practicesByPCN[key] = [];
        // @ts-ignore
        practicesByPCN[key].push(pr);
      }
    }

    // @ts-ignore
    const pcns = pcnsRaw.map(pcn => ({ ...pcn, practices: practicesByPCN[String(pcn._id)] || [] }));
    res.json({ icb: { ...icb, federations, pcns } });
  } catch (err) {
    // @ts-ignore
    console.error("getICBById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch ICB" });
  }
};

export const createICB = async (req: Request, res: Response) => {
  try {
    const { name, region, code, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "ICB name is required" });
    // @ts-ignore
    const icb = await ICB.create({ name: name.trim(), region: region || "", code: code || "", notes: notes || "", createdBy: req.user._id });
    res.status(201).json({ icb, message: "ICB created successfully" });
  } catch (err) {
    // @ts-ignore
    if (err.code === 11000) return res.status(409).json({ message: "An ICB with this name already exists" });
    res.status(500).json({ message: "Failed to create ICB" });
  }
};

export const updateICB = async (req: Request, res: Response) => {
  try {
    const { name, region, code, notes, isActive } = req.body;
    const icb = await ICB.findByIdAndUpdate(
      req.params.id,
      { name, region, code, notes, ...(isActive !== undefined && { isActive }) },
      { new: true, runValidators: true }
    );
    if (!icb) return res.status(404).json({ message: "ICB not found" });
    res.json({ icb, message: "ICB updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update ICB" });
  }
};

export const deleteICB = async (req: Request, res: Response) => {
  try {
    const [pcnCount, fedCount] = await Promise.all([
      PCN.countDocuments({ icb: req.params.id, isActive: true }),
      Federation.countDocuments({ icb: req.params.id, isActive: true }),
    ]);
    if (pcnCount > 0 || fedCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${pcnCount} active PCN(s) and ${fedCount} federation(s) are linked` });
    await ICB.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "ICB deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete ICB" });
  }
};

/* ── Federation CRUD ──────────────────────────────────────────────── */
export const getFederations = async (req: Request, res: Response) => {
  try {
    const filter = { isActive: true };
    // @ts-ignore
    if (req.query.icb) filter.icb = req.query.icb;
    const federations = await Federation.find(filter).populate("icb", "name region").sort({ name: 1 }).lean();
    res.json({ federations });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch federations" });
  }
};

export const createFederation = async (req: Request, res: Response) => {
  try {
    const { name, icb, type, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Federation name is required" });
    // @ts-ignore
    const fed = await Federation.create({ name: name.trim(), ...(icb && { icb }), type: type || "federation", notes: notes || "", createdBy: req.user._id });
    const populated = await fed.populate("icb", "name");
    res.status(201).json({ federation: populated, message: "Federation created" });
  } catch (err) {
    res.status(500).json({ message: "Failed to create federation" });
  }
};

export const updateFederation = async (req: Request, res: Response) => {
  try {
    const fed = await Federation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).populate("icb", "name");
    if (!fed) return res.status(404).json({ message: "Federation not found" });
    res.json({ federation: fed, message: "Federation updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update federation" });
  }
};

export const deleteFederation = async (req: Request, res: Response) => {
  try {
    const pcnCount = await PCN.countDocuments({ federation: req.params.id, isActive: true });
    if (pcnCount > 0) return res.status(409).json({ message: `Cannot delete — ${pcnCount} active PCN(s) are linked` });
    await Federation.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Federation deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete federation" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   PCN CRUD
══════════════════════════════════════════════════════════════════ */

export const getPCNById = async (req: Request, res: Response) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region code")
      .populate("federation", "name type")
      .populate({
        path:   "complianceGroups",
        select: "name active displayOrder documents",
        populate: { path: "documents", select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active" },
      })
      .populate({
        path:   "complianceGroup",
        select: "name active displayOrder documents",
        populate: { path: "documents", select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active" },
      })
      .populate("activeClinicians",    "name role")
      .populate("restrictedClinicians","name email role")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    if (Array.isArray(pcn.reportingArchive)) {
      pcn.reportingArchive = [...pcn.reportingArchive]
        .sort((a, b) => {
          if (b.year !== a.year) return (b.year || 0) - (a.year || 0);
          return (b.month || 0) - (a.month || 0);
        })
        .slice(0, 3);
    }

    const practices = await Practice.find({ pcn: pcn._id, isActive: true })
      .select("name odsCode address city postcode fte contractType systemAccessNotes isActive linkedClinicians ndaSigned dsaSigned mouReceived welcomePackSent mobilisationPlanSent templateInstalled reportsImported")
      .lean();
    pcn.practices = practices;

    // @ts-ignore
    recordView(PCN, req.params.id, req.user._id);
    res.json({ pcn });
  } catch (err) {
    // @ts-ignore
    console.error("getPCNById ERROR:", err.message, err.stack);
    // @ts-ignore
    res.status(500).json({ message: "Failed to fetch PCN", detail: err.message });
  }
};

export const createPCN = async (req: Request, res: Response) => {
  try {
    const { name, icb, decisionMakers, financeContacts, tags, priority, clientFacingData } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "PCN name is required" });

    const payload = normalizeComplianceGroup({
      ...req.body,
      decisionMakers:  decisionMakers  || [],
      financeContacts: financeContacts || [],
      tags:            Array.isArray(tags) ? tags : [],
      priority:        priority        || "normal",
      clientFacingData: clientFacingData || {},
    });

    // @ts-ignore
    const pcn = await PCN.create({ ...payload, name: name.trim(), createdBy: req.user._id });
    const populated = await PCN.findById(pcn._id)
      .populate("icb", "name")
      .populate("federation", "name type")
      .populate("complianceGroup",  "name")
      .populate("complianceGroups", "name")
      .lean();

    await logAudit(req, "CREATE_CLIENT", "PCN", {
      resourceId: pcn._id, detail: `PCN created: ${pcn.name}`, after: safeJson(populated),
    });
    res.status(201).json({ pcn: populated, message: "PCN created" });
  } catch (err) {
    // @ts-ignore
    console.error("createPCN ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create PCN" });
  }
};

export const updatePCN = async (req: Request, res: Response) => {
  try {
    validateObjectIdOr400(req.params.id, "PCN id");
    const existing = await PCN.findById(req.params.id)
      .populate("icb", "name region")
      .populate("federation", "name type")
      .populate("complianceGroup",  "name")
      .populate("complianceGroups", "name")
      .lean();
    if (!existing) return res.status(404).json({ message: "PCN not found" });

    let payload = normalizeComplianceGroup(req.body);

    if (
      Object.prototype.hasOwnProperty.call(payload, "complianceGroups") ||
      Object.prototype.hasOwnProperty.call(payload, "complianceGroup")
    ) {
      const previousGroups = [
        // @ts-ignore
        ...(existing.complianceGroups || []).map((g) => String(g)),
        ...(!(existing.complianceGroups || []).length && existing.complianceGroup ? [String(existing.complianceGroup)] : []),
      ].sort();
      const nextGroups = [
        // @ts-ignore
        ...(payload.complianceGroups || []).map((g) => String(g)),
        // @ts-ignore
        ...(!(payload.complianceGroups || []).length && payload.complianceGroup ? [String(payload.complianceGroup)] : []),
      ].sort();
      // @ts-ignore
      if (JSON.stringify(previousGroups) !== JSON.stringify(nextGroups)) payload.groupDocuments = [];
    }

    const selectiveMerge = {};
    if (Object.prototype.hasOwnProperty.call(req.body, "decisionMakers"))
      // @ts-ignore
      selectiveMerge.decisionMakers  = req.body.decisionMakers  || [];
    if (Object.prototype.hasOwnProperty.call(req.body, "financeContacts"))
      // @ts-ignore
      selectiveMerge.financeContacts = req.body.financeContacts || [];
    if (Object.prototype.hasOwnProperty.call(req.body, "tags"))
      // @ts-ignore
      selectiveMerge.tags            = Array.isArray(req.body.tags) ? req.body.tags : [];
    if (Object.prototype.hasOwnProperty.call(req.body, "priority"))
      // @ts-ignore
      selectiveMerge.priority        = req.body.priority || "normal";
    if (Object.prototype.hasOwnProperty.call(req.body, "clientFacingData"))
      // @ts-ignore
      selectiveMerge.clientFacingData = { ...(req.body.clientFacingData || {}), lastUpdated: new Date() };

    payload = { ...payload, ...selectiveMerge };

    //   Contract start date kabhi update nahi hoti — sirf creation pe set hoti hai
    // @ts-ignore
    delete payload.contractStartDate;

    //   NEW — Rate & Contract date change tracking
    // @ts-ignore
    trackFieldChanges(existing, payload, req.user._id);

    const pcn = await PCN.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
      .populate("icb", "name region")
      .populate("federation", "name type")
      .populate("complianceGroup",  "name")
      .populate("complianceGroups", "name")
      .lean();

    const beforeGroups = (existing.complianceGroups?.length ? existing.complianceGroups : (existing.complianceGroup ? [existing.complianceGroup] : []))
      // @ts-ignore
      .map((g) => g?.name).filter(Boolean);
    const afterGroups  = (pcn.complianceGroups?.length ? pcn.complianceGroups : (pcn.complianceGroup ? [pcn.complianceGroup] : []))
      // @ts-ignore
      .map((g) => g?.name).filter(Boolean);

    await logAudit(req, "UPDATE_CLIENT", "PCN", {
      resourceId: pcn._id,
      detail: beforeGroups.join("|") !== afterGroups.join("|")
        ? formatComplianceGroupDetail(beforeGroups, afterGroups)
        : `PCN updated: ${pcn.name}`,
      before: safeJson(existing),
      after:  safeJson(pcn),
    });
    res.json({ pcn, message: "PCN updated" });
  } catch (err) {
    // @ts-ignore
    console.error("updatePCN ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update PCN" });
  }
};

export const deletePCN = async (req: Request, res: Response) => {
  try {
    validateObjectIdOr400(req.params.id, "PCN id");
    const practiceCount = await Practice.countDocuments({ pcn: req.params.id, isActive: true });
    if (practiceCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${practiceCount} active practice(s) are linked` });
    const existing = await PCN.findById(req.params.id).lean();
    await PCN.findByIdAndUpdate(req.params.id, { isActive: false });
    if (existing) {
      await logAudit(req, "DELETE_CLIENT", "PCN", {
        resourceId: existing._id, detail: `PCN soft-deleted: ${existing.name}`,
        before: safeJson(existing), after: { isActive: false },
      });
    }
    res.json({ message: "PCN deleted" });
  } catch (err) {
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete PCN" });
  }
};

export const updateRestrictedClinicians = async (req: Request, res: Response) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const pcn = await PCN.findByIdAndUpdate(req.params.id, { restrictedClinicians: clinicianIds }, { new: true })
      .populate("restrictedClinicians", "name email role");
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ pcn, message: "Restricted clinicians updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ── Monthly Meetings + Rollup ───────────────────────────────────── */
export const getMonthlyMeetings = async (req: Request, res: Response) => {
  try {
    const pcn = await PCN.findById(req.params.id).select("monthlyMeetings name").lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ meetings: pcn.monthlyMeetings || [], pcnName: pcn.name });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch meetings" });
  }
};

export const upsertMonthlyMeeting = async (req: Request, res: Response) => {
  try {
    const { month, date, type, attendees, notes, status } = req.body;
    if (!month) return res.status(400).json({ message: "Month is required" });
    const pcn = await PCN.findById(req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    const meetings = Array.isArray(pcn.monthlyMeetings) ? [...pcn.monthlyMeetings] : [];
    const idx = meetings.findIndex(m => m.month === month && m.type === type);
    if (idx > -1) { Object.assign(meetings[idx], { date, attendees, notes, status }); }
    else { meetings.push({ month, date, type, attendees, notes, status }); }
    await PCN.findByIdAndUpdate(req.params.id, { monthlyMeetings: meetings });
    res.json({ meetings, message: "Meeting saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save meeting" });
  }
};

export const getPCNRollup = async (req: Request, res: Response) => {
  try {
    const pcn = await PCN.findById(req.params.id).populate("icb", "name region").populate("federation", "name type").lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    const practices    = await Practice.find({ pcn: req.params.id, isActive: true }).lean();
    const complianceKeys = ["ndaSigned","dsaSigned","mouReceived","welcomePackSent","mobilisationPlanSent","confidentialityFormSigned","prescribingPoliciesShared","remoteAccessSetup","templateInstalled","reportsImported"];
    // @ts-ignore
    const complianceByPractice = practices.map(p => {
      const done = complianceKeys.filter(k => p[k]).length;
      return { practiceId: p._id, practiceName: p.name, done, total: complianceKeys.length, score: Math.round((done / complianceKeys.length) * 100) };
    });
    const avgCompliance = complianceByPractice.length
      // @ts-ignore
      ? Math.round(complianceByPractice.reduce((s, p) => s + p.score, 0) / complianceByPractice.length) : 0;
    res.json({ pcn, practices, rollup: { practiceCount: practices.length, avgCompliance, complianceByPractice, hourlyRate: pcn.hourlyRate, contractStartDate: pcn.contractStartDate } });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate rollup report" });
  }
};

/* ══════════════════════════════════════════════════════════════════
     NEW — GET /pcn/:id/rate-history
   Full chronological rate/contract-date history for ONE client.
══════════════════════════════════════════════════════════════════ */
export const getPCNRateHistory = async (req: Request, res: Response) => {
  try {
    validateObjectIdOr400(req.params.id, "PCN id");

    const pcn = await PCN.findById(req.params.id)
      .select("name hourlyRate contractType contractStartDate contractRenewalDate contractExpiryDate hourlyRateHistory")
      .populate("hourlyRateHistory.changedBy", "name role")
      .lean();

    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const history = [...(pcn.hourlyRateHistory || [])].sort(
      // @ts-ignore
      (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
    );

    res.json({
      entityName: pcn.name,
      current: {
        hourlyRate:          pcn.hourlyRate,
        contractType:        pcn.contractType,
        contractStartDate:   pcn.contractStartDate,
        contractRenewalDate: pcn.contractRenewalDate,
        contractExpiryDate:  pcn.contractExpiryDate,
      },
      history,
    });
  } catch (err) {
    // @ts-ignore
    console.error("getPCNRateHistory ERROR:", err.message);
    // @ts-ignore
    res.status(err.statusCode || 500).json({
      // @ts-ignore
      message: err.statusCode ? err.message : "Failed to fetch rate history",
    });
  }
};

/* ══════════════════════════════════════════════════════════════════
     NEW — GET /pcn/rate-history/summary
   ALL clients with current rate/dates + last change + history count.
══════════════════════════════════════════════════════════════════ */
export const getAllPCNRateSummary = async (req: Request, res: Response) => {
  try {
    const pcns = await PCN.find({ isActive: true })
      .select("name icb hourlyRate contractType contractStartDate contractRenewalDate contractExpiryDate hourlyRateHistory")
      .populate("icb", "name")
      .sort({ name: 1 })
      .lean();

    // @ts-ignore
    const summary = pcns.map((pcn) => {
      const history = [...(pcn.hourlyRateHistory || [])].sort(
        // @ts-ignore
        (a, b) => new Date(b.changedAt) - new Date(a.changedAt)
      );
      const lastChange = history[0] || null;

      return {
        _id:                 pcn._id,
        name:                pcn.name,
        icbName:             pcn.icb?.name || null,
        contractType:        pcn.contractType,
        hourlyRate:          pcn.hourlyRate,
        contractStartDate:   pcn.contractStartDate,
        contractRenewalDate: pcn.contractRenewalDate,
        contractExpiryDate:  pcn.contractExpiryDate,
        historyCount:        history.length,
        lastChange,
      };
    });

    res.json({ clients: summary, total: summary.length });
  } catch (err) {
    // @ts-ignore
    console.error("getAllPCNRateSummary ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch rate summary" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   PRACTICE CRUD
══════════════════════════════════════════════════════════════════ */

export const getPractices = async (req: Request, res: Response) => {
  try {
    const filter = { isActive: true };
    // @ts-ignore
    if (req.query.pcn) filter.pcn = req.query.pcn;

    const practices = await Practice.find(filter)
      .populate({
        path:   "pcn",
        select: "name icb federation",
        populate: [
          { path: "icb",        select: "name region code" },
          { path: "federation", select: "name type" },
        ],
      })
      .populate("complianceGroup", "name")
      .sort({ name: 1 })
      .lean();

    // @ts-ignore
    const normalized = practices.map((p) => ({
      ...p,
      client: p.pcn ?? null,
    }));

    res.json({ practices: normalized });
  } catch (err) {
    // @ts-ignore
    console.error("getPractices ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch practices" });
  }
};

export const getPracticeById = async (req: Request, res: Response) => {
  try {
    const practice = await Practice.findById(req.params.id)
      .populate({
        path:   "pcn",
        select: "name icb federation",
        populate: [
          { path: "icb",        select: "name region code" },
          { path: "federation", select: "name type"        },
        ],
      })
      .populate({
        path:   "complianceGroup",
        select: "name active displayOrder documents",
        populate: {
          path:   "documents",
          select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active",
        },
      })
      .populate("linkedClinicians",     "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    if (Array.isArray(practice.reportingArchive)) {
      practice.reportingArchive = [...practice.reportingArchive]
        .sort((a, b) => {
          if (b.year !== a.year) return (b.year || 0) - (a.year || 0);
          return (b.month || 0) - (a.month || 0);
        })
        .slice(0, 3);
    }

    // @ts-ignore
    recordView(Practice, req.params.id, req.user._id);
    res.json({ practice });
  } catch (err) {
    // @ts-ignore
    console.error("getPracticeById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch practice" });
  }
};

export const createPractice = async (req: Request, res: Response) => {
  try {
    const { name, pcn } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Practice name is required" });
    if (!pcn)          return res.status(400).json({ message: "PCN is required" });
    const payload  = normalizeComplianceGroup(req.body);
    // @ts-ignore
    const practice = await Practice.create({ ...payload, name: name.trim(), createdBy: req.user._id });
    const populated = await Practice.findById(practice._id)
      .populate({
        path:   "pcn",
        select: "name icb federation",
        populate: [
          { path: "icb",        select: "name region code" },
          { path: "federation", select: "name type"        },
        ],
      })
      .populate("complianceGroup", "name")
      .lean();
    await logAudit(req, "CREATE_CLIENT", "Practice", { resourceId: practice._id, detail: `Practice created: ${practice.name}`, after: safeJson(populated) });
    res.status(201).json({ practice: populated, message: "Practice created" });
  } catch (err) {
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create practice" });
  }
};

export const updatePractice = async (req: Request, res: Response) => {
  try {
    validateObjectIdOr400(req.params.id, "Practice id");
    const existing = await Practice.findById(req.params.id)
      .populate("pcn","name").populate("complianceGroup","name")
      .populate("linkedClinicians","name email role").populate("restrictedClinicians","name email role").lean();
    if (!existing) return res.status(404).json({ message: "Practice not found" });

    const payload = normalizeComplianceGroup(req.body);
    if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
      const prev = (existing.complianceGroup || []).map((g: any) => String(g._id || g)).sort().join(",");
      // @ts-ignore
      const next = (payload.complianceGroup || []).map(String).sort().join(",");
      // @ts-ignore
      if (prev !== next) payload.groupDocuments = [];
    }  

    const practice = await Practice.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
  .populate({
    path:   "pcn",
    select: "name icb federation",
    populate: [
      { path: "icb",        select: "name region code" },
      { path: "federation", select: "name type"        },
    ],
  })
  .populate("complianceGroup","name")
  .populate("linkedClinicians","name email role")
  .populate("restrictedClinicians","name email role")
  .lean();

    const beforeGroups = (existing.complianceGroup || []).map((g: any) => g.name).filter(Boolean);
    const afterGroups  = (practice.complianceGroup || []).map((g: any) => g.name).filter(Boolean);
    await logAudit(req, "UPDATE_CLIENT", "Practice", {
      resourceId: practice._id,
      detail: beforeGroups.join("|") !== afterGroups.join("|")
        // @ts-ignore
        ? formatComplianceGroupDetail(beforeGroups, afterGroups)
        : `Practice updated: ${practice.name}`,
      before: safeJson(existing), after: safeJson(practice),
    });
    res.json({ practice, message: "Practice updated" });
  } catch (err) {
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update practice" });
  }
};

export const deletePractice = async (req: Request, res: Response) => {
  try {
    validateObjectIdOr400(req.params.id, "Practice id");
    const existing = await Practice.findById(req.params.id).lean();
    await Practice.findByIdAndUpdate(req.params.id, { isActive: false });
    if (existing) {
      await logAudit(req, "DELETE_CLIENT", "Practice", {
        resourceId: existing._id, detail: `Practice soft-deleted: ${existing.name}`,
        before: safeJson(existing), after: { isActive: false },
      });
    }
    res.json({ message: "Practice deleted" });
  } catch (err) {
    // @ts-ignore
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete practice" });
  }
};

export const updatePracticeRestricted = async (req: Request, res: Response) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const practice = await Practice.findByIdAndUpdate(req.params.id, { restrictedClinicians: clinicianIds }, { new: true })
      .populate("restrictedClinicians", "name email role");
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    res.json({ practice, message: "Restricted clinicians updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   CONTACT HISTORY  
══════════════════════════════════════════════════════════════════ */

// @ts-ignore
const resolveEntityId = (rawId) => {
  if (!rawId || typeof rawId !== "string" || !rawId.trim()) return null;
  return String(rawId).trim();
};

export const getContactHistory = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = resolveEntityId(req.params.entityId);

    if (!entityId) return res.status(400).json({ message: "Invalid entityId" });

    const { type, starred, page = 1, limit = 100 } = req.query;

    const EntityModel = getEntityModelByType(entityType);
    let entityExists = false;
    try {
      const entity = await EntityModel.findById(entityId).select("name").lean();
      entityExists = !!entity;
    } catch (lookupErr) {
      // @ts-ignore
      console.warn(`getContactHistory entity check failed: ${lookupErr.message}`);
      entityExists = true;
    }
    if (!entityExists) return res.status(404).json({ message: `${entityType} not found` });

    const filter = { entityType, entityId };
    // @ts-ignore
    if (type && type !== "all") filter.type    = type;
    // @ts-ignore
    if (starred === "true")     filter.starred = true;

    const pageNum  = Math.max(1, Number(page)  || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 100));
    const skip     = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      ContactHistory.find(filter)
        .populate("createdBy", "name role")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ContactHistory.countDocuments(filter),
    ]);

    // @ts-ignore
    const normalizedLogs = (logs || []).map((log) => ({
      ...log,
      notes:   log.notes  || log.detail       || "",
      date:    log.date   || log.contactDate  || null,
      time:    log.time   || "",
      starred: !!log.starred,
    }));

    return res.json({
      logs:  normalizedLogs,
      total,
      page:  pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    // @ts-ignore
    console.error("getContactHistory ERROR:", err.message, err.stack);
    // @ts-ignore
    return res.status(err.statusCode || 500).json({
      // @ts-ignore
      message: err.statusCode ? err.message : "Failed to fetch contact history",
    });
  }
};

export const addContactHistory = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = resolveEntityId(req.params.entityId);

    if (!entityId) return res.status(400).json({ message: "Invalid entityId" });

    const {
      type, subject, notes, date, time, attachments,
      outcome, followUpDate, followUpNote,
    } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!type)            return res.status(400).json({ message: "Type is required" });

    const EntityModel = getEntityModelByType(entityType);
    const entity = await EntityModel.findById(entityId).select("name").lean();
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const log = await ContactHistory.create({
      entityType,
      entityId,
      type,
      subject:      subject.trim(),
      notes:        notes || "",
      date:         date  ? new Date(date) : new Date(),
      time:         time  || new Date().toTimeString().slice(0, 5),
      attachments:  attachments || [],
      outcome:      outcome?.trim()      || "",
      followUpDate: followUpDate ? new Date(followUpDate) : null,
      followUpNote: followUpNote?.trim() || "",
      // @ts-ignore
      createdBy:    req.user._id,
    });

    const populated = await ContactHistory.findById(log._id)
      .populate("createdBy", "name role")
      .lean();

    return res.status(201).json({ log: populated, message: "Log added" });
  } catch (err) {
    // @ts-ignore
    console.error("addContactHistory ERROR:", err.message);
    // @ts-ignore
    return res.status(err.statusCode || 500).json({
      // @ts-ignore
      message: err.statusCode ? err.message : "Failed to add log",
    });
  }
};

export const updateContactHistory = async (req: Request, res: Response) => {
  try {
    const {
      subject, notes, type, date, time,
      outcome, followUpDate, followUpNote,
    } = req.body;

    const log = await ContactHistory.findByIdAndUpdate(
      req.params.logId,
      {
        ...(subject      !== undefined && { subject }),
        ...(notes        !== undefined && { notes }),
        ...(type         !== undefined && { type }),
        ...(date         !== undefined && { date }),
        ...(time         !== undefined && { time }),
        ...(outcome      !== undefined && { outcome:      outcome?.trim()    || "" }),
        ...(followUpDate !== undefined && { followUpDate: followUpDate ? new Date(followUpDate) : null }),
        ...(followUpNote !== undefined && { followUpNote: followUpNote?.trim() || "" }),
      },
      { new: true }
    ).populate("createdBy", "name role");

    if (!log) return res.status(404).json({ message: "Log not found" });
    return res.json({ log, message: "Log updated" });
  } catch (err) {
    // @ts-ignore
    console.error("updateContactHistory ERROR:", err.message);
    return res.status(500).json({ message: "Failed to update log" });
  }
};

export const toggleStarred = async (req: Request, res: Response) => {
  try {
    const existing = await ContactHistory.findById(req.params.logId).lean();
    if (!existing) return res.status(404).json({ message: "Log not found" });

    const starred = !existing.starred;
    const updated = await ContactHistory.findByIdAndUpdate(
      req.params.logId,
      { starred },
      { new: true }
    ).lean();

    return res.json({ log: updated, starred, message: starred ? "Starred" : "Unstarred" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to toggle star" });
  }
};

export const deleteContactHistory = async (req: Request, res: Response) => {
  try {
    const log = await ContactHistory.findByIdAndDelete(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    return res.json({ message: "Log deleted" });
  } catch (err) {
    return res.status(500).json({ message: "Failed to delete log" });
  }
};

export const requestSystemAccess = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = resolveEntityId(req.params.entityId);

    if (!entityId) return res.status(400).json({ message: "Invalid entityId" });

    const { systems, clinicianDetails, notes } = req.body;
    if (!systems?.length)        return res.status(400).json({ message: "At least one system must be selected" });
    if (!clinicianDetails?.name) return res.status(400).json({ message: "Clinician name is required" });

    const systemList = systems.join(", ");
    const emailBody  = `Dear Team,\n\nPlease arrange system access for:\n\nName: ${clinicianDetails.name}\nType: ${clinicianDetails.clinicianType || "N/A"}\nGPhC: ${clinicianDetails.gphcNumber || "N/A"}\nSmart Card: ${clinicianDetails.smartCardNumber || "N/A"}\nEmail: ${clinicianDetails.email || "N/A"}\nPhone: ${clinicianDetails.phone || "N/A"}\n\nSystems: ${systemList}\nNotes: ${notes || "None"}\n\nKind regards,\nCore Prescribing Solutions`.trim();

    const log = await ContactHistory.create({
      entityType,
      entityId,
      type:      "system_access",
      subject:   `System Access Request — ${clinicianDetails.name} — ${systemList}`,
      notes:     emailBody,
      date:      new Date(),
      time:      new Date().toTimeString().slice(0, 5),
      // @ts-ignore
      createdBy: req.user._id,
    });

    return res.json({ message: "System access request logged successfully", log });
  } catch (err) {
    return res.status(500).json({ message: "Failed to process system access request" });
  }
};

export const sendMassEmail = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = resolveEntityId(req.params.entityId);

    if (!entityId) return res.status(400).json({ message: "Invalid entityId" });

    const { subject, body, recipients } = req.body;
    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!body?.trim())    return res.status(400).json({ message: "Body is required" });

    // @ts-ignore
    const valid = (recipients || []).filter(r => r.email?.includes("@"));
    if (!valid.length) return res.status(400).json({ message: "At least one valid recipient email is required" });

    const trackingId = crypto.randomUUID();
    const apiBase    = `${req.protocol}://${req.get("host")}`;
    const pixel      = `<img src="${apiBase}/api/clients/track/${trackingId}" width="1" height="1" style="display:none;"/>`;

    const recipientResults = [];
    for (const r of valid) {
      try {
        await transporter.sendMail({
          from:    process.env.EMAIL_FROM,
          to:      r.name ? `"${r.name}" <${r.email}>` : r.email,
          subject,
          html:    body + pixel,
        });
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      } catch (_) {
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      }
    }

    await ContactHistory.create({
      entityType,
      entityId,
      type:         "email",
      subject:      `[Mass Email] ${subject}`,
      notes:        body.replace(/<[^>]+>/g, "").slice(0, 500),
      date:         new Date(),
      time:         new Date().toTimeString().slice(0, 5),
      isMassEmail:  true,
      recipients:   recipientResults,
      emailTracking: { sent: true, sentAt: new Date(), trackingId },
      // @ts-ignore
      createdBy:    req.user._id,
    });

    return res.json({ message: `Email sent to ${recipientResults.length} recipient(s)` });
  } catch (err) {
    return res.status(500).json({ message: "Failed to send email" });
  }
};

export const trackEmailOpen = async (req: Request, res: Response) => {
  try {
    await ContactHistory.findOneAndUpdate(
      { "emailTracking.trackingId": req.params.trackingId },
      { "emailTracking.opened": true, "emailTracking.openedAt": new Date() }
    );
  } catch (_) {}
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-cache,no-store,must-revalidate" });
  res.end(pixel);
};

export const searchClients = async (req: Request, res: Response) => {
  try {
    // @ts-ignore
    const q = req.query.q?.trim();
    if (!q) return res.json({ results: [] });
    const regex = new RegExp(q, "i");
    const [icbs, pcns, practices] = await Promise.all([
      ICB.find({ name: regex, isActive: true }).select("name region").limit(5).lean(),
      PCN.find({ name: regex, isActive: true }).select("name").limit(5).lean(),
      Practice.find({ $or: [{ name: regex }, { odsCode: regex }], isActive: true }).select("name odsCode").limit(5).lean(),
    ]);
    res.json({
      results: [
        // @ts-ignore
        ...icbs.map(i => ({ ...i, _type: "icb" })),
        // @ts-ignore
        ...pcns.map(p => ({ ...p, _type: "pcn" })),
        // @ts-ignore
        ...practices.map(p => ({ ...p, _type: "practice" })),
      ],
    });
  } catch (err) {
    res.status(500).json({ message: "Search failed" });
  }
};