/**
 * clientController.js  —  CPS Client Management
 *
 * UPDATED (Apr 2026)
 *
 * FIXED:
 *   • getContactHistory: entityId string → ObjectId cast (logs not showing bug)
 *   • addContactHistory: entityId string → ObjectId cast
 *   • requestSystemAccess: entityId string → ObjectId cast
 *   • sendMassEmail: entityId string → ObjectId cast
 *   • All previous fixes kept (CastError for federation names, defensive hierarchy)
 *   • getPCNById: complianceGroups now deep-populated with documents
 *     (was only fetching "name active displayOrder" — documents field missing
 *      caused buildSelectedGroups to get undefined documents → 500 crash)
 *   • getPCNs: icb now populated with name/region/code
 *     (was missing — caused ICB badge to not show in PCNListPage)
 *
 * NEW (Apr 2026):
 *   • getICBById: now returns federations + pcns (with practices) for ICBDetailPage
 */

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

/* ─────────────────────────────────────────────────
   HELPER: safe ObjectId cast
───────────────────────────────────────────────── */
const toObjectId = (id) => {
  return normalizeId(id);
};

const validateObjectIdOr400 = (id, label = "id") => {
  const objectId = toObjectId(id);
  if (!objectId) {
    const error = new Error(`Invalid ${label}`);
    error.statusCode = 400;
    throw error;
  }
  return objectId;
};

const safeJson = (value) => JSON.parse(JSON.stringify(value ?? null));

const formatComplianceGroupDetail = (beforeGroups = [], afterGroups = []) => {
  const beforeText = beforeGroups.length ? beforeGroups.join(", ") : "none";
  const afterText = afterGroups.length ? afterGroups.join(", ") : "none";
  return `Compliance groups changed from [${beforeText}] to [${afterText}]`;
};

const normalizeEntityType = (entityType = "") => {
  const normalized = String(entityType).trim().toLowerCase();
  if (normalized === "pcn") return "PCN";
  if (normalized === "practice") return "Practice";
  if (normalized === "federation") return "Federation";
  if (normalized === "icb") return "ICB";
  const error = new Error("Invalid entityType");
  error.statusCode = 400;
  throw error;
};

const getEntityModelByType = (entityType) => {
  if (entityType === "PCN") return PCN;
  if (entityType === "Practice") return Practice;
  if (entityType === "Federation") return Federation;
  if (entityType === "ICB") return ICB;
  const error = new Error("Invalid entityType");
  error.statusCode = 400;
  throw error;
};

const normalizeComplianceGroup = (payload = {}) => {
  const next = { ...payload };

  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroups")) {
    const complianceGroups = Array.from(
      new Set(
        (Array.isArray(payload.complianceGroups) ? payload.complianceGroups : [payload.complianceGroups])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    next.complianceGroups = complianceGroups;
    next.complianceGroup = complianceGroups[0] || null;
    return next;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
    next.complianceGroup = payload.complianceGroup || null;
    next.complianceGroups = next.complianceGroup ? [next.complianceGroup] : [];
  }

  return next;
};

/* ─────────────────────────────────────────────────
   EMAIL TRANSPORT
───────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ─────────────────────────────────────────────────
   HELPER: record who viewed a record
───────────────────────────────────────────────── */
const recordView = async (Model, id, userId) => {
  try {
    await Model.findByIdAndUpdate(id, {
      $push: { viewedBy: { user: userId, viewedAt: new Date() } },
    });
  } catch (_) {}
};

/* ─────────────────────────────────────────────────
   HIERARCHY — FULLY DEFENSIVE (CastError FIXED)
───────────────────────────────────────────────── */
export const getHierarchy = async (req, res) => {
  try {
    const [icbs, federationsRaw, pcnsRaw, practices] = await Promise.all([
      ICB.find({ isActive: true }).sort({ name: 1 }).lean(),
      Federation.find({ isActive: true }).sort({ name: 1 }).lean(),
      PCN.find({ isActive: true }).sort({ name: 1 }).lean(),
      Practice.find({ isActive: true })
        .select("name odsCode pcn isActive contractType fte")
        .sort({ name: 1 })
        .lean(),
    ]);

    const fedMapById = {};
    const fedMapByName = {};
    for (const f of federationsRaw) {
      fedMapById[String(f._id)] = f;
      fedMapByName[f.name.trim().toLowerCase()] = f;
    }

    const practicesByPCN = {};
    for (const pr of practices) {
      const key = String(pr.pcn);
      if (!practicesByPCN[key]) practicesByPCN[key] = [];
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
          federation = /^[0-9a-fA-F]{24}$/.test(fedField)
            ? fedMapById[fedField]
            : fedMapByName[fedField.trim().toLowerCase()];
        } else if (fedField._id) {
          federation = fedMapById[String(fedField._id)];
        }
      }

      if (!pcnsByICB[icbKey]) pcnsByICB[icbKey] = [];
      pcnsByICB[icbKey].push({
        ...pcn,
        federation: federation || null,
        practices: practicesByPCN[String(pcn._id)] || [],
      });
    }

    const tree = icbs.map(icb => ({
      ...icb,
      federations: federationsRaw.filter(f => String(f.icb) === String(icb._id)),
      pcns:        pcnsByICB[String(icb._id)] || [],
    }));

    res.json({
      tree,
      counts: {
        icbs:        icbs.length,
        federations: federationsRaw.length,
        pcns:        pcnsRaw.length,
        practices:   practices.length,
      },
    });
  } catch (err) {
    console.error("getHierarchy ERROR:", err.message, err.stack);
    res.status(500).json({ message: "Failed to load hierarchy", detail: err.message });
  }
};

/* ─────────────────────────────────────────────────
   PCNs — FULLY DEFENSIVE
   ★ FIXED: .populate("icb", "name region code") added
     Pehle ICB populate nahi hota tha — PCNListPage mein
     ICB badge nahi dikhta tha kyunki pcn.icb sirf ObjectId thi
───────────────────────────────────────────────── */
export const getPCNs = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.icb)        filter.icb        = req.query.icb;
    if (req.query.federation) filter.federation = req.query.federation;

    const pcnsRaw = await PCN.find(filter)
      .populate("icb", "name region code")   // ← FIXED: yeh line add ki
      .populate("complianceGroup", "name")
      .populate("complianceGroups", "name")
      .sort({ name: 1 })
      .lean();

    const federations = await Federation.find({ isActive: true })
      .select("name type icb")
      .lean();

    const fedMapById = {};
    const fedMapByName = {};
    for (const f of federations) {
      fedMapById[String(f._id)] = f;
      fedMapByName[f.name.trim().toLowerCase()] = f;
    }

    const pcns = pcnsRaw.map(pcn => {
      let federation = null;
      const fedField = pcn.federation;
      if (fedField) {
        if (typeof fedField === "string") {
          federation = /^[0-9a-fA-F]{24}$/.test(fedField)
            ? fedMapById[fedField]
            : fedMapByName[fedField.trim().toLowerCase()];
        } else if (fedField._id) {
          federation = fedMapById[String(fedField._id)];
        }
      }
      return { ...pcn, federation: federation || null };
    });

    res.json({ pcns });
  } catch (err) {
    console.error("getPCNs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch PCNs" });
  }
};

/* ─────────────────────────────────────────────────
   ICB CRUD
───────────────────────────────────────────────── */
export const getICBs = async (req, res) => {
  try {
    const icbs = await ICB.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ icbs });
  } catch (err) {
    console.error("getICBs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch ICBs" });
  }
};

/* ─────────────────────────────────────────────────
    UPDATED: getICBById
   Now returns federations + pcns (with practices)
   so ICBDetailPage can show full drill-down
───────────────────────────────────────────────── */
export const getICBById = async (req, res) => {
  try {
    const icb = await ICB.findById(req.params.id).lean();
    if (!icb) return res.status(404).json({ message: "ICB not found" });

    const [federations, pcnsRaw] = await Promise.all([
      Federation.find({ icb: req.params.id, isActive: true })
        .select("name type notes")
        .sort({ name: 1 })
        .lean(),
      PCN.find({ icb: req.params.id, isActive: true })
        .populate("federation", "name type")
        .select("name contractType annualSpend federation xeroCode")
        .sort({ name: 1 })
        .lean(),
    ]);

    const practicesByPCN = {};
    if (pcnsRaw.length > 0) {
      const pcnIds = pcnsRaw.map(p => p._id);
      const allPractices = await Practice.find({
        pcn: { $in: pcnIds },
        isActive: true,
      })
        .select("name odsCode fte contractType pcn")
        .lean();

      for (const pr of allPractices) {
        const key = String(pr.pcn);
        if (!practicesByPCN[key]) practicesByPCN[key] = [];
        practicesByPCN[key].push(pr);
      }
    }

    const pcns = pcnsRaw.map(pcn => ({
      ...pcn,
      practices: practicesByPCN[String(pcn._id)] || [],
    }));

    res.json({ icb: { ...icb, federations, pcns } });
  } catch (err) {
    console.error("getICBById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch ICB" });
  }
};

export const createICB = async (req, res) => {
  try {
    const { name, region, code, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "ICB name is required" });
    const icb = await ICB.create({
      name: name.trim(), region: region || "", code: code || "", notes: notes || "",
      createdBy: req.user._id,
    });
    res.status(201).json({ icb, message: "ICB created successfully" });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "An ICB with this name already exists" });
    console.error("createICB ERROR:", err.message);
    res.status(500).json({ message: "Failed to create ICB" });
  }
};

export const updateICB = async (req, res) => {
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
    console.error("updateICB ERROR:", err.message);
    res.status(500).json({ message: "Failed to update ICB" });
  }
};

export const deleteICB = async (req, res) => {
  try {
    const [pcnCount, fedCount] = await Promise.all([
      PCN.countDocuments({ icb: req.params.id, isActive: true }),
      Federation.countDocuments({ icb: req.params.id, isActive: true }),
    ]);
    if (pcnCount > 0 || fedCount > 0)
      return res.status(409).json({
        message: `Cannot delete — ${pcnCount} active PCN(s) and ${fedCount} federation(s) are linked`,
      });
    await ICB.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "ICB deleted" });
  } catch (err) {
    console.error("deleteICB ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete ICB" });
  }
};

/* ─────────────────────────────────────────────────
   FEDERATION / INT CRUD
───────────────────────────────────────────────── */
export const getFederations = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.icb) filter.icb = req.query.icb;
    const federations = await Federation.find(filter)
      .populate("icb", "name region")
      .sort({ name: 1 })
      .lean();
    res.json({ federations });
  } catch (err) {
    console.error("getFederations ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch federations" });
  }
};

export const createFederation = async (req, res) => {
  try {
    const { name, icb, type, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Federation name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });
    const fed = await Federation.create({
      name: name.trim(), icb, type: type || "federation", notes: notes || "",
      createdBy: req.user._id,
    });
    const populated = await fed.populate("icb", "name");
    res.status(201).json({ federation: populated, message: "Federation created" });
  } catch (err) {
    console.error("createFederation ERROR:", err.message);
    res.status(500).json({ message: "Failed to create federation" });
  }
};

export const updateFederation = async (req, res) => {
  try {
    const fed = await Federation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("icb", "name");
    if (!fed) return res.status(404).json({ message: "Federation not found" });
    res.json({ federation: fed, message: "Federation updated" });
  } catch (err) {
    console.error("updateFederation ERROR:", err.message);
    res.status(500).json({ message: "Failed to update federation" });
  }
};

export const deleteFederation = async (req, res) => {
  try {
    const pcnCount = await PCN.countDocuments({ federation: req.params.id, isActive: true });
    if (pcnCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${pcnCount} active PCN(s) are linked` });
    await Federation.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Federation deleted" });
  } catch (err) {
    console.error("deleteFederation ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete federation" });
  }
};

/* ─────────────────────────────────────────────────
   PCN CRUD
───────────────────────────────────────────────── */
export const getPCNById = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region code")
      .populate("federation", "name type")
      .populate({
        path: "complianceGroups",
        select: "name active displayOrder documents",
        populate: {
          path: "documents",
          select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active",
        },
      })
      .populate({
        path: "complianceGroup",
        select: "name active displayOrder documents",
        populate: { path: "documents", select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active" },
      })
      .populate("activeClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const practices = await Practice.find({ pcn: pcn._id, isActive: true })
      .select("name odsCode address city postcode fte contractType systemAccessNotes isActive linkedClinicians ndaSigned dsaSigned mouReceived welcomePackSent mobilisationPlanSent templateInstalled reportsImported")
      .lean();
    pcn.practices = practices;

    recordView(PCN, req.params.id, req.user._id);
    res.json({ pcn });
  } catch (err) {
    console.error("getPCNById ERROR:", err.message, err.stack);
    res.status(500).json({ message: "Failed to fetch PCN", detail: err.message });
  }
};

export const createPCN = async (req, res) => {
  try {
    const { name, icb } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "PCN name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });
    const payload = normalizeComplianceGroup(req.body);
    const pcn = await PCN.create({ ...payload, name: name.trim(), createdBy: req.user._id });
    const populated = await PCN.findById(pcn._id)
      .populate("icb", "name")
      .populate("federation", "name type")
      .populate("complianceGroup", "name")
      .populate("complianceGroups", "name")
      .lean();
    await logAudit(req, "CREATE_CLIENT", "PCN", {
      resourceId: pcn._id,
      detail: `PCN created: ${pcn.name}`,
      after: safeJson(populated),
    });
    res.status(201).json({ pcn: populated, message: "PCN created" });
  } catch (err) {
    console.error("createPCN ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create PCN" });
  }
};

export const updatePCN = async (req, res) => {
  try {
    validateObjectIdOr400(req.params.id, "PCN id");
    const existing = await PCN.findById(req.params.id)
      .populate("icb", "name region")
      .populate("federation", "name type")
      .populate("complianceGroup", "name")
      .populate("complianceGroups", "name")
      .lean();
    if (!existing) return res.status(404).json({ message: "PCN not found" });

    const payload = normalizeComplianceGroup(req.body);
    if (
      Object.prototype.hasOwnProperty.call(payload, "complianceGroups") ||
      Object.prototype.hasOwnProperty.call(payload, "complianceGroup")
    ) {
      const previousGroups = [
        ...(existing.complianceGroups || []).map((groupId) => String(groupId)),
        ...(!(existing.complianceGroups || []).length && existing.complianceGroup ? [String(existing.complianceGroup)] : []),
      ].sort();
      const nextGroups = [
        ...(payload.complianceGroups || []).map((groupId) => String(groupId)),
        ...(!(payload.complianceGroups || []).length && payload.complianceGroup ? [String(payload.complianceGroup)] : []),
      ].sort();
      if (JSON.stringify(previousGroups) !== JSON.stringify(nextGroups)) payload.groupDocuments = [];
    }

    const pcn = await PCN.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
      .populate("icb", "name region")
      .populate("federation", "name type")
      .populate("complianceGroup", "name")
      .populate("complianceGroups", "name")
      .lean();
    const beforeGroups = (existing.complianceGroups?.length ? existing.complianceGroups : (existing.complianceGroup ? [existing.complianceGroup] : []))
      .map((group) => group?.name)
      .filter(Boolean);
    const afterGroups = (pcn.complianceGroups?.length ? pcn.complianceGroups : (pcn.complianceGroup ? [pcn.complianceGroup] : []))
      .map((group) => group?.name)
      .filter(Boolean);
    await logAudit(req, "UPDATE_CLIENT", "PCN", {
      resourceId: pcn._id,
      detail: beforeGroups.join("|") !== afterGroups.join("|")
        ? formatComplianceGroupDetail(beforeGroups, afterGroups)
        : `PCN updated: ${pcn.name}`,
      before: safeJson(existing),
      after: safeJson(pcn),
    });
    res.json({ pcn, message: "PCN updated" });
  } catch (err) {
    console.error("updatePCN ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update PCN" });
  }
};

export const deletePCN = async (req, res) => {
  try {
    validateObjectIdOr400(req.params.id, "PCN id");
    const practiceCount = await Practice.countDocuments({ pcn: req.params.id, isActive: true });
    if (practiceCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${practiceCount} active practice(s) are linked` });
    const existing = await PCN.findById(req.params.id).lean();
    await PCN.findByIdAndUpdate(req.params.id, { isActive: false });
    if (existing) {
      await logAudit(req, "DELETE_CLIENT", "PCN", {
        resourceId: existing._id,
        detail: `PCN soft-deleted: ${existing.name}`,
        before: safeJson(existing),
        after: { isActive: false },
      });
    }
    res.json({ message: "PCN deleted" });
  } catch (err) {
    console.error("deletePCN ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete PCN" });
  }
};

export const updateRestrictedClinicians = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const pcn = await PCN.findByIdAndUpdate(
      req.params.id,
      { restrictedClinicians: clinicianIds },
      { new: true }
    ).populate("restrictedClinicians", "name email role");
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ pcn, message: "Restricted clinicians updated" });
  } catch (err) {
    console.error("updateRestrictedClinicians ERROR:", err.message);
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ─────────────────────────────────────────────────
   MONTHLY MEETINGS + ROLLUP
───────────────────────────────────────────────── */
export const getMonthlyMeetings = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id).select("monthlyMeetings name").lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ meetings: pcn.monthlyMeetings || [], pcnName: pcn.name });
  } catch (err) {
    console.error("getMonthlyMeetings ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch meetings" });
  }
};

export const upsertMonthlyMeeting = async (req, res) => {
  try {
    const { month, date, type, attendees, notes, status } = req.body;
    if (!month) return res.status(400).json({ message: "Month is required" });

    const pcn = await PCN.findById(req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const idx = pcn.monthlyMeetings.findIndex(m => m.month === month && m.type === type);
    if (idx > -1) {
      Object.assign(pcn.monthlyMeetings[idx], { date, attendees, notes, status });
    } else {
      pcn.monthlyMeetings.push({ month, date, type, attendees, notes, status });
    }
    await pcn.save();
    res.json({ meetings: pcn.monthlyMeetings, message: "Meeting saved" });
  } catch (err) {
    console.error("upsertMonthlyMeeting ERROR:", err.message);
    res.status(500).json({ message: "Failed to save meeting" });
  }
};

export const getPCNRollup = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region")
      .populate("federation", "name type")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const practices = await Practice.find({ pcn: req.params.id, isActive: true }).lean();

    const complianceKeys = [
      "ndaSigned","dsaSigned","mouReceived","welcomePackSent",
      "mobilisationPlanSent","confidentialityFormSigned",
      "prescribingPoliciesShared","remoteAccessSetup",
      "templateInstalled","reportsImported",
    ];

    const complianceByPractice = practices.map(p => {
      const done = complianceKeys.filter(k => p[k]).length;
      return {
        practiceId:   p._id,
        practiceName: p.name,
        done,
        total:        complianceKeys.length,
        score:        Math.round((done / complianceKeys.length) * 100),
      };
    });

    const avgCompliance = complianceByPractice.length
      ? Math.round(complianceByPractice.reduce((s, p) => s + p.score, 0) / complianceByPractice.length)
      : 0;

    const systemCounts = {};
    for (const p of practices) {
      for (const sa of (p.systemAccess || [])) {
        if (!systemCounts[sa.system]) systemCounts[sa.system] = { granted: 0, pending: 0, total: 0 };
        systemCounts[sa.system].total++;
        if (["granted","view_only"].includes(sa.status)) systemCounts[sa.system].granted++;
        if (["requested","pending"].includes(sa.status)) systemCounts[sa.system].pending++;
      }
    }

    res.json({
      pcn,
      practices,
      rollup: {
        practiceCount: practices.length,
        avgCompliance,
        complianceByPractice,
        annualSpend: pcn.annualSpend,
        systemCounts,
      },
    });
  } catch (err) {
    console.error("getPCNRollup ERROR:", err.message, err.stack);
    res.status(500).json({ message: "Failed to generate rollup report" });
  }
};

/* ─────────────────────────────────────────────────
   PRACTICE CRUD
───────────────────────────────────────────────── */
export const getPractices = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.pcn) filter.pcn = req.query.pcn;
    const practices = await Practice.find(filter)
      .populate("pcn", "name")
      .populate("complianceGroup", "name")
      .sort({ name: 1 })
      .lean();
    res.json({ practices });
  } catch (err) {
    console.error("getPractices ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch practices" });
  }
};

export const getPracticeById = async (req, res) => {
  try {
    const practice = await Practice.findById(req.params.id)
      .populate("pcn", "name icb")
      .populate({
        path: "complianceGroup",
        select: "name active displayOrder documents",
        populate: { path: "documents", select: "name mandatory expirable displayOrder defaultExpiryDays defaultReminderDays active" },
      })
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    recordView(Practice, req.params.id, req.user._id);
    res.json({ practice });
  } catch (err) {
    console.error("getPracticeById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch practice" });
  }
};

export const createPractice = async (req, res) => {
  try {
    const { name, pcn } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Practice name is required" });
    if (!pcn)          return res.status(400).json({ message: "PCN is required" });
    const payload = normalizeComplianceGroup(req.body);
    const practice = await Practice.create({ ...payload, name: name.trim(), createdBy: req.user._id });
    const populated = await Practice.findById(practice._id)
      .populate("pcn", "name")
      .populate("complianceGroup", "name")
      .lean();
    await logAudit(req, "CREATE_CLIENT", "Practice", {
      resourceId: practice._id,
      detail: `Practice created: ${practice.name}`,
      after: safeJson(populated),
    });
    res.status(201).json({ practice: populated, message: "Practice created" });
  } catch (err) {
    console.error("createPractice ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create practice" });
  }
};

export const updatePractice = async (req, res) => {
  try {
    validateObjectIdOr400(req.params.id, "Practice id");
    const existing = await Practice.findById(req.params.id)
      .populate("pcn", "name")
      .populate("complianceGroup", "name")
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!existing) return res.status(404).json({ message: "Practice not found" });

    const payload = normalizeComplianceGroup(req.body);
    if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
      const previousGroup = existing.complianceGroup ? String(existing.complianceGroup) : "";
      const nextGroup = payload.complianceGroup ? String(payload.complianceGroup) : "";
      if (previousGroup !== nextGroup) payload.groupDocuments = [];
    }

    const practice = await Practice.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true })
      .populate("pcn", "name")
      .populate("complianceGroup", "name")
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    const beforeGroups = existing.complianceGroup?.name ? [existing.complianceGroup.name] : [];
    const afterGroups = practice.complianceGroup?.name ? [practice.complianceGroup.name] : [];
    await logAudit(req, "UPDATE_CLIENT", "Practice", {
      resourceId: practice._id,
      detail: beforeGroups.join("|") !== afterGroups.join("|")
        ? formatComplianceGroupDetail(beforeGroups, afterGroups)
        : `Practice updated: ${practice.name}`,
      before: safeJson(existing),
      after: safeJson(practice),
    });
    res.json({ practice, message: "Practice updated" });
  } catch (err) {
    console.error("updatePractice ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update practice" });
  }
};

export const deletePractice = async (req, res) => {
  try {
    validateObjectIdOr400(req.params.id, "Practice id");
    const existing = await Practice.findById(req.params.id).lean();
    await Practice.findByIdAndUpdate(req.params.id, { isActive: false });
    if (existing) {
      await logAudit(req, "DELETE_CLIENT", "Practice", {
        resourceId: existing._id,
        detail: `Practice soft-deleted: ${existing.name}`,
        before: safeJson(existing),
        after: { isActive: false },
      });
    }
    res.json({ message: "Practice deleted" });
  } catch (err) {
    console.error("deletePractice ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete practice" });
  }
};

export const updatePracticeRestricted = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const practice = await Practice.findByIdAndUpdate(
      req.params.id,
      { restrictedClinicians: clinicianIds },
      { new: true }
    ).populate("restrictedClinicians", "name email role");
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    res.json({ practice, message: "Restricted clinicians updated" });
  } catch (err) {
    console.error("updatePracticeRestricted ERROR:", err.message);
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ─────────────────────────────────────────────────
   CONTACT HISTORY — ★ FIXED: entityId ObjectId cast
───────────────────────────────────────────────── */
export const getContactHistory = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const { entityId } = req.params;
    const { type, starred, page = 1, limit = 100 } = req.query;

    const entityObjId = toObjectId(entityId);
    if (!entityObjId) return res.status(400).json({ message: "Invalid entityId" });

    const EntityModel = getEntityModelByType(entityType);
    const entityExists = await EntityModel.exists({ _id: entityObjId });
    if (!entityExists) return res.status(404).json({ message: `${entityType} not found` });

    const filter = { entityType, entityId: entityObjId };
    if (type && type !== "all") filter.type = type;
    if (starred === "true")     filter.starred = true;

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      ContactHistory.find(filter)
        .populate("createdBy", "name role")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ContactHistory.countDocuments(filter),
    ]);

    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error("getContactHistory ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch contact history" });
  }
};

export const addContactHistory = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const { entityId } = req.params;
    const { type, subject, notes, date, time, attachments } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!type)            return res.status(400).json({ message: "Type is required" });

    const entityObjId = toObjectId(entityId);
    if (!entityObjId) return res.status(400).json({ message: "Invalid entityId" });
    const EntityModel = getEntityModelByType(entityType);
    const entityExists = await EntityModel.exists({ _id: entityObjId });
    if (!entityExists) return res.status(404).json({ message: `${entityType} not found` });

    const log = await ContactHistory.create({
      entityType,
      entityId: entityObjId,
      type,
      subject: subject.trim(),
      notes:   notes || "",
      date:    date ? new Date(date) : new Date(),
      time:    time || new Date().toTimeString().slice(0, 5),
      attachments: attachments || [],
      createdBy: req.user._id,
    });

    const populated = await ContactHistory.findById(log._id).populate("createdBy", "name role").lean();
    res.status(201).json({ log: populated, message: "Log added" });
  } catch (err) {
    console.error("addContactHistory ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to add log" });
  }
};

export const updateContactHistory = async (req, res) => {
  try {
    const { subject, notes, type, date, time } = req.body;
    const log = await ContactHistory.findByIdAndUpdate(
      req.params.logId,
      {
        ...(subject              && { subject }),
        ...(notes !== undefined  && { notes }),
        ...(type                 && { type }),
        ...(date                 && { date }),
        ...(time                 && { time }),
      },
      { new: true }
    ).populate("createdBy", "name role");
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ log, message: "Log updated" });
  } catch (err) {
    console.error("updateContactHistory ERROR:", err.message);
    res.status(500).json({ message: "Failed to update log" });
  }
};

export const toggleStarred = async (req, res) => {
  try {
    const log = await ContactHistory.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    log.starred = !log.starred;
    await log.save();
    res.json({ log, starred: log.starred, message: log.starred ? "Starred" : "Unstarred" });
  } catch (err) {
    console.error("toggleStarred ERROR:", err.message);
    res.status(500).json({ message: "Failed to toggle star" });
  }
};

export const deleteContactHistory = async (req, res) => {
  try {
    const log = await ContactHistory.findByIdAndDelete(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ message: "Log deleted" });
  } catch (err) {
    console.error("deleteContactHistory ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete log" });
  }
};

/* ─────────────────────────────────────────────────
   SYSTEM ACCESS REQUEST
───────────────────────────────────────────────── */
export const requestSystemAccess = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { systems, clinicianDetails, notes } = req.body;

    if (!systems?.length)        return res.status(400).json({ message: "At least one system must be selected" });
    if (!clinicianDetails?.name) return res.status(400).json({ message: "Clinician name is required" });

    const entityObjId = toObjectId(entityId);
    if (!entityObjId) return res.status(400).json({ message: "Invalid entityId" });

    const systemList = systems.join(", ");
    const emailBody = `
Dear Team,

Please arrange system access for the following clinician:

Name:              ${clinicianDetails.name}
Clinician Type:    ${clinicianDetails.clinicianType || "N/A"}
GPhC Number:       ${clinicianDetails.gphcNumber || "N/A"}
Smart Card Number: ${clinicianDetails.smartCardNumber || "N/A"}
Email:             ${clinicianDetails.email || "N/A"}
Phone:             ${clinicianDetails.phone || "N/A"}

Systems Required:  ${systemList}

Additional Notes:  ${notes || "None"}

Kind regards,
Core Prescribing Solutions
`.trim();

    const log = await ContactHistory.create({
      entityType,
      entityId: entityObjId,
      type:    "system_access",
      subject: `System Access Request — ${clinicianDetails.name} — ${systemList}`,
      notes:   emailBody,
      date:    new Date(),
      time:    new Date().toTimeString().slice(0, 5),
      createdBy: req.user._id,
    });

    res.json({ message: "System access request logged successfully", log });
  } catch (err) {
    console.error("requestSystemAccess ERROR:", err.message);
    res.status(500).json({ message: "Failed to process system access request" });
  }
};

/* ─────────────────────────────────────────────────
   MASS EMAIL
───────────────────────────────────────────────── */
export const sendMassEmail = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { subject, body, recipients } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!body?.trim())    return res.status(400).json({ message: "Body is required" });

    const valid = (recipients || []).filter(r => r.email?.includes("@"));
    if (!valid.length)    return res.status(400).json({ message: "At least one valid recipient email is required" });

    const entityObjId = toObjectId(entityId);
    if (!entityObjId) return res.status(400).json({ message: "Invalid entityId" });

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
      } catch (mailErr) {
        console.error("Mail error:", r.email, mailErr.message);
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      }
    }

    await ContactHistory.create({
      entityType,
      entityId: entityObjId,
      type:        "email",
      subject:     `[Mass Email] ${subject}`,
      notes:       body.replace(/<[^>]+>/g, "").slice(0, 500),
      date:        new Date(),
      time:        new Date().toTimeString().slice(0, 5),
      isMassEmail: true,
      recipients:  recipientResults,
      emailTracking: { sent: true, sentAt: new Date(), trackingId },
      createdBy: req.user._id,
    });

    res.json({ message: `Email sent to ${recipientResults.length} recipient(s)` });
  } catch (err) {
    console.error("sendMassEmail ERROR:", err.message);
    res.status(500).json({ message: "Failed to send email" });
  }
};

/* ─────────────────────────────────────────────────
   EMAIL TRACKING PIXEL
───────────────────────────────────────────────── */
export const trackEmailOpen = async (req, res) => {
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

/* ─────────────────────────────────────────────────
   SEARCH
───────────────────────────────────────────────── */
export const searchClients = async (req, res) => {
  try {
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
        ...icbs.map(i => ({ ...i, _type: "icb" })),
        ...pcns.map(p => ({ ...p, _type: "pcn" })),
        ...practices.map(p => ({ ...p, _type: "practice" })),
      ],
    });
  } catch (err) {
    console.error("searchClients ERROR:", err.message);
    res.status(500).json({ message: "Search failed" });
  }
};
