import { Request, Response, NextFunction } from 'express';
/**
 * controllers/clinicianController.js — Module 3
 *
 * UPDATED: getClinicians now embeds complianceSummary per clinician
 * so the list page can show compliance progress without extra API calls.
 */

import bcrypt                  from "bcryptjs";
import Clinician               from "../models/Clinician.js";
import ClinicianClientHistory  from "../models/ClinicianClientHistory.js";
import ClinicianLeaveEntry     from "../models/ClinicianLeaveEntry.js";
import ClinicianComplianceDoc  from "../models/ClinicianComplianceDoc.js";
import DocumentGroup           from "../models/DocumentGroup.js";
import User                    from "../models/User.js";
import { logAudit }            from "../middleware/auditLogger.js";
import { normalizeId }         from "../lib/ids.js";
import { calcAllBalances }     from "../lib/leaveCalc.js";
import { linkUserToClinician, unlinkUserFromClinician } from "../lib/clinicianLink.js";
import { syncClinicianStub } from "../lib/syncClinicianStub.js";
import { sendWelcomeEmail }    from "../utils/sendEmail.js";
import { query }               from "../config/db.js";
import { fetchShiftCountsByClinician } from "../lib/shiftCounts.js";
import crypto from "crypto";

/* ─── helpers ────────────────────────────────────────────── */
// @ts-ignore
const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
// @ts-ignore
const toId = (v) => normalizeId(v);

// @ts-ignore
const validateId = (id, label = "id") => {
  const v = toId(id);
  if (!v) {
    const e = new Error(`Invalid ${label}`);
    // @ts-ignore
    e.statusCode = 400;
    throw e;
  }
  return v;
};

// @ts-ignore
const matchesSearch = (clin, q) => {
  if (!q) return true;
  const hay = [
    clin.fullName,
    clin.email,
    clin.phone,
    clin.gphcNumber,
    clin.smartCard,
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(String(q).toLowerCase());
};

// @ts-ignore
const isExpired = (doc) => {
  if (!doc?.expiryDate) return false;
  return new Date(doc.expiryDate).getTime() < Date.now();
};

/* ─── LIST ───────────────────────────────────────────────── */
export const getClinicians = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      search = "",
      type,
      contract,
      restricted,
      active,
      opsLead,
      supervisor,
    } = req.query;

    let docs = await Clinician.find({}).lean();

    // @ts-ignore
    if (type)       docs = docs.filter((d) => d.clinicianType === type);
    // @ts-ignore
    if (contract)   docs = docs.filter((d) => d.contractType === contract);
    // @ts-ignore
    if (opsLead)    docs = docs.filter((d) => String(d.opsLead) === String(opsLead));
    // @ts-ignore
    if (supervisor) docs = docs.filter((d) => String(d.supervisor) === String(supervisor));

    if (typeof restricted !== "undefined" && restricted !== "")
      // @ts-ignore
      docs = docs.filter((d) => Boolean(d.isRestricted) === (restricted === "true"));

    if (typeof active !== "undefined" && active !== "")
      // @ts-ignore
      docs = docs.filter((d) => Boolean(d.isActive) === (active === "true"));

    // @ts-ignore
    docs = docs.filter((d) => matchesSearch(d, search));

    const userIds = new Set();
    // @ts-ignore
    docs.forEach((d) => {
      if (d.opsLead)    userIds.add(String(d.opsLead));
      if (d.supervisor) userIds.add(String(d.supervisor));
    });

    const users = userIds.size ? await User.find({}).lean() : [];
    // @ts-ignore
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const allLeave = await ClinicianLeaveEntry.find({}).lean();
    const leaveByClinician = new Map();
    for (const entry of allLeave) {
      const cid = String(entry.clinician || "");
      if (!cid) continue;
      if (!leaveByClinician.has(cid)) leaveByClinician.set(cid, []);
      leaveByClinician.get(cid).push(entry);
    }

    const shiftCounts = await fetchShiftCountsByClinician();

    /* ── Compliance summary for all clinicians ── */
    // 1. Fetch all compliance docs in one query
    const allCompDocs = await ClinicianComplianceDoc.find({}).lean();
    const compDocsByClinician = new Map();
    for (const d of allCompDocs) {
      const cid = String(d.clinician || "");
      if (!cid) continue;
      if (!compDocsByClinician.has(cid)) compDocsByClinician.set(cid, []);
      compDocsByClinician.get(cid).push(d);
    }

    // 2. Fetch all active document groups with their documents
    const allGroups = await DocumentGroup.find({ active: { $ne: false } })
      .populate({
        path:  "documents",
        select: "name mandatory active",
        match:  { active: { $ne: false } },
      })
      .lean();

    // @ts-ignore
    const groupMap = new Map(allGroups.map((g) => [String(g._id), g]));

    /* ── Build complianceSummary per clinician ── */
    // @ts-ignore
    const buildComplianceSummary = (clinician) => {
      const assignedGroupIds = clinician.complianceGroups || [];
      if (assignedGroupIds.length === 0) return null;

      const clinDocs     = compDocsByClinician.get(String(clinician._id)) || [];
      // @ts-ignore
      const docByKey     = new Map(clinDocs.map((d) => [String(d.docKey  || ""), d]));
      // @ts-ignore
      const docByName    = new Map(clinDocs.map((d) => [String(d.docName || "").toLowerCase(), d]));

      let total    = 0;
      let uploaded = 0;
      let missing  = 0;

      for (const gid of assignedGroupIds) {
        const group = groupMap.get(String(gid));
        if (!group) continue;

        // @ts-ignore
        const groupDocs = (group.documents || []).filter((d) => d && d.active !== false);
        for (const doc of groupDocs) {
          total++;
          const existing =
            docByKey.get(String(doc._id)) ||
            docByName.get(String(doc.name || "").toLowerCase()) ||
            null;

          // @ts-ignore
          const rawStatus  = existing?.status || "missing";
          const expired    = existing ? isExpired(existing) : false;
          const status     = rawStatus === "approved" && expired ? "expired" : rawStatus;

          if (status === "approved" || status === "uploaded") {
            uploaded++;
          } else {
            missing++;
          }
        }
      }

      return {
        groups:   assignedGroupIds.length,
        total,
        uploaded,
        missing,
        remaining: total - uploaded,
      };
    };

    // @ts-ignore
    const enriched = docs.map((d) => {
      const balances = calcAllBalances(leaveByClinician.get(String(d._id)) || []);
      const primaryBalance = balances.find((b) => b.contract === d.contractType) || balances[0];
      const shiftCount = shiftCounts.get(String(d._id)) || 0;
      const complianceSummary = buildComplianceSummary(d);

      return {
        ...d,
        // @ts-ignore
        opsLeadName:       userMap.get(String(d.opsLead))?.fullName || userMap.get(String(d.opsLead))?.name || "",
        // @ts-ignore
        supervisorName:    userMap.get(String(d.supervisor))?.fullName || userMap.get(String(d.supervisor))?.name || "",
        alBalance:         primaryBalance,
        leaveBalances:     balances,
        shiftCount,
        complianceSummary, // ← NEW: null if no groups assigned, object otherwise
      };
    });

    // @ts-ignore
    enriched.sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));

    res.json({ clinicians: enriched, total: enriched.length });
  } catch (err) {
    next(err);
  }
};

/* ─── CREATE ─────────────────────────────────────────────── */
export const createClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      createLogin,
      loginPassword,
      ...clinicianData
    } = req.body;

    // @ts-ignore
    const payload = { ...clinicianData, createdBy: req.user?._id || null };
    const created = await Clinician.create(payload);

    let userCreated = null;
    let userError   = null;

    const shouldCreate =
      createLogin === true ||
      createLogin === "true" ||
      createLogin === 1;

    if (shouldCreate && created.email && loginPassword) {
      try {
        const normalizedEmail = String(created.email).trim().toLowerCase();

        const existing = await User.findOne({ email: normalizedEmail }).lean();
        if (existing) {
          userError = `A login account with email ${normalizedEmail} already exists`;
        } else {
          const hashed = await bcrypt.hash(String(loginPassword), 12);

          userCreated = await User.create({
            name:               created.fullName || normalizedEmail,
            email:              normalizedEmail,
            password:           hashed,
            role:               "clinician",
            isActive:           true,
            mustChangePassword: false,
            isAnonymised:       false,
            clinicianId:        created._id,
            // @ts-ignore
            createdBy:          req.user?._id || null,
            lastLogin:          null,
            phone:              created.phone  || "",
            department:         "Clinical",
            jobTitle:           created.clinicianType || "Clinician",
            startDate:          created.startDate || null,
            emergencyContact:   { name: "", relationship: "", phone: "", email: "" },
          });

          try {
            await sendWelcomeEmail({
              name:     userCreated.name,
              email:    userCreated.email,
              password: loginPassword,
              role:     "clinician",
            });
          } catch (emailErr) {
            // @ts-ignore
            console.error("[createClinician EMAIL ERROR]", emailErr.message);
          }

          await Clinician.findByIdAndUpdate(created._id, { user: userCreated._id });
        }
      } catch (err) {
        // @ts-ignore
        console.error("[createClinician USER ERROR]", err.message);
        // @ts-ignore
        userError = err.message;
      }
    }

    await logAudit(req, "CREATE_CLINICIAN", "Clinician", {
      resourceId: created._id,
      detail: `Created clinician "${created.fullName || created.email || created._id}"${userCreated ? " with login account" : ""}`,
      after:  safeJson(created),
    });

    res.status(201).json({
      clinician: created,
      userCreated: userCreated ? {
        id:    userCreated._id,
        email: userCreated.email,
        role:  userCreated.role,
      } : null,
      userError: userError || null,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── DETAIL ─────────────────────────────────────────────── */
export const getClinicianById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const clinician = await Clinician.findById(id)
      .populate("opsLead",    "fullName email role")
      .populate("supervisor", "fullName email role")
      .populate("user",       "fullName email role")
      .lean();

    if (!clinician)
      return res.status(404).json({ message: "Clinician not found" });

    const leaveEntries  = await ClinicianLeaveEntry.find({ clinician: id }).lean();
    const leaveBalances = calcAllBalances(leaveEntries);

    res.json({ clinician: { ...clinician, leaveBalances } });
  } catch (err) {
    next(err);
  }
};

/* ─── LINK USER ACCOUNT (super admin) ───────────────────── */
export const linkClinicianUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const userId = req.body?.userId ?? req.body?.user_id ?? null;

    if (!userId) {
      const before = await Clinician.findById(id).lean();
      const uid = before?.user?._id || before?.user || before?.userId;
      if (uid) await unlinkUserFromClinician(String(uid));
      const clinician = await Clinician.findById(id)
        .populate("opsLead", "fullName email role")
        .populate("supervisor", "fullName email role")
        .populate("user", "fullName email role")
        .lean();
      return res.json({ clinician, linked: false });
    }

    const userRow = await query(
      `SELECT id, data FROM app_records WHERE model = 'user' AND id = $1 LIMIT 1`,
      [String(userId)]
    );
    const role = String(userRow.rows[0]?.data?.role || "").toLowerCase();
    if (!userRow.rows[0]) return res.status(404).json({ message: "User not found" });
    if (role && role !== "clinician") {
      return res.status(400).json({ message: "Selected user must have the clinician role" });
    }

    await linkUserToClinician(String(userId), id);

    const clinician = await Clinician.findById(id)
      .populate("opsLead", "fullName email role")
      .populate("supervisor", "fullName email role")
      .populate("user", "fullName email role")
      .lean();

    await syncClinicianStub(clinician);

    await logAudit(req, "CLINICIAN_USER_RELINKED", "Clinician", {
      resourceId: id,
      detail: `Linked clinician to user ${userId}`,
      after: { userId, clinicianId: id },
    });

    res.json({ clinician, linked: true, userId: String(userId) });
  } catch (err) {
    // @ts-ignore
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    const body = { ...req.body };
    delete body._id;
    delete body.createdAt;
    delete body.createLogin;
    delete body.loginPassword;

    if ("startDate" in body) {
      body.startDate = body.startDate ? new Date(body.startDate).toISOString() : null;
    }
    if ("endDate" in body) {
      body.endDate = body.endDate ? new Date(body.endDate).toISOString() : null;
    }
    if ("opsLead" in body) {
      body.opsLead = body.opsLead ? String(body.opsLead) : null;
    }
    if ("supervisor" in body) {
      body.supervisor = body.supervisor ? String(body.supervisor) : null;
    }
    if ("workingHours" in body) {
      body.workingHours = Number(body.workingHours) || 0;
    }

    await Clinician.findByIdAndUpdate(id, body, { new: true });

    const clinician = await Clinician.findById(id)
      .populate("opsLead", "fullName email role")
      .populate("supervisor", "fullName email role")
      .populate("user", "fullName email role")
      .lean();

    await syncClinicianStub(clinician);

    await logAudit(req, "UPDATE_CLINICIAN", "Clinician", {
      resourceId: id,
      detail: `Updated clinician "${clinician?.fullName || id}"`,
      before: safeJson(before),
      after:  safeJson(clinician),
    });

    res.json({ clinician });
  } catch (err) {
    next(err);
  }
};

/* ─── DELETE ─────────────────────────────────────────────── */
export const deleteClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    await Clinician.findByIdAndDelete(id);

    await logAudit(req, "DELETE_CLINICIAN", "Clinician", {
      resourceId: id,
      detail: `Deleted clinician "${before.fullName || id}"`,
      before: safeJson(before),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/* ─── CLIENT HISTORY — GET ───────────────────────────────── */
export const getClientHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const rows = await ClinicianClientHistory.find({ clinician: id })
      .populate("pcn",      "name")
      .populate("practice", "name")
      .lean();

    // @ts-ignore
    rows.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
};

/* ─── CLIENT HISTORY — ADD ───────────────────────────────── */
export const addClientHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = req.body || {};
    const record = await ClinicianClientHistory.create({
      clinician:      id,
      pcn:            body.pcn            || null,
      practice:       body.practice       || null,
      contract:       body.contract       || clinician.contractType || "ARRS",
      startDate:      body.startDate      || null,
      endDate:        body.endDate        || null,
      status:         body.status         || "active",
      systemAccess:   Array.isArray(body.systemAccess) ? body.systemAccess : [],
      isRestricted:   body.isRestricted   === true || body.isRestricted === "true",
      restrictReason: body.restrictReason || "",
      // @ts-ignore
      createdBy:      req.user?._id       || null,
    });

    await logAudit(req, "ADD_CLIENT_HISTORY", "ClinicianClientHistory", {
      resourceId: record._id,
      detail: `Added client history record for clinician "${clinician.fullName || id}"`,
      after:  safeJson(record),
    });

    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
};

/* ─── CLIENT HISTORY — UPDATE ────────────────────────────── */
export const updateClientHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id       = validateId(req.params.id);
    const recordId = validateId(req.params.recordId, "recordId");

    const before = await ClinicianClientHistory.findById(recordId).lean();
    if (!before) return res.status(404).json({ message: "Record not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Record does not belong to this clinician" });

    const body = { ...req.body };
    delete body._id;
    delete body.clinician;

    const updated = await ClinicianClientHistory.findByIdAndUpdate(recordId, body, { new: true });

    await logAudit(req, "UPDATE_CLIENT_HISTORY", "ClinicianClientHistory", {
      resourceId: recordId,
      detail: `Updated client history record for clinician ${id}`,
      before: safeJson(before),
      after:  safeJson(updated),
    });

    res.json({ record: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── CLIENT HISTORY — UPDATE SYSTEM ACCESS ─────────────── */
export const updateSystemAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id       = validateId(req.params.id);
    const recordId = validateId(req.params.recordId, "recordId");

    const before = await ClinicianClientHistory.findById(recordId).lean();
    if (!before) return res.status(404).json({ message: "Record not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Record does not belong to this clinician" });

    const systemAccess = Array.isArray(req.body?.systemAccess) ? req.body.systemAccess : [];

    const updated = await ClinicianClientHistory.findByIdAndUpdate(
      recordId,
      { systemAccess },
      { new: true }
    );

    await logAudit(req, "UPDATE_SYSTEM_ACCESS", "ClinicianClientHistory", {
      resourceId: recordId,
      detail: `Updated system access for clinician ${id} at record ${recordId}`,
      before: safeJson(before.systemAccess),
      after:  safeJson(systemAccess),
    });

    res.json({ record: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── RESTRICT / UNRESTRICT ──────────────────────────────── */
export const restrictClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const reason = String(req.body?.reason || "").trim();

    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    const updated = await Clinician.findByIdAndUpdate(
      id,
      { isRestricted: true, restrictReason: reason },
      { new: true }
    );

    await logAudit(req, "RESTRICT_CLINICIAN", "Clinician", {
      resourceId: id,
      detail: `Restricted clinician "${before.fullName || id}"${reason ? ` — reason: ${reason}` : ""}`,
      before: { isRestricted: before.isRestricted, restrictReason: before.restrictReason },
      after:  { isRestricted: true, restrictReason: reason },
    });

    res.json({ clinician: updated });
  } catch (err) {
    next(err);
  }
};

export const unrestrictClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    const updated = await Clinician.findByIdAndUpdate(
      id,
      { isRestricted: false, restrictReason: "" },
      { new: true }
    );

    await logAudit(req, "UNRESTRICT_CLINICIAN", "Clinician", {
      resourceId: id,
      detail: `Lifted restriction on clinician "${before.fullName || id}"`,
      before: { isRestricted: before.isRestricted, restrictReason: before.restrictReason },
      after:  { isRestricted: false, restrictReason: "" },
    });

    res.json({ clinician: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── Login account (super_admin) ─────────────────────────── */
export const updateClinicianUserLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const userId = toId(clinician.user || clinician.userId);
    if (!userId) return res.status(400).json({ message: "No login account linked to this clinician" });

    const newEmail = String(req.body?.email || "").trim().toLowerCase();
    if (!newEmail) return res.status(400).json({ message: "email is required" });

    const dup = await User.findOne({ email: newEmail }).lean();
    if (dup && String(dup._id) !== String(userId)) {
      return res.status(409).json({ message: "Email already in use by another account" });
    }

    const before = await User.findById(userId).lean();
    const updated = await User.findByIdAndUpdate(userId, { email: newEmail }, { new: true });

    await Clinician.findByIdAndUpdate(id, { email: newEmail });

    await logAudit(req, "UPDATE_CLINICIAN_LOGIN_EMAIL", "User", {
      resourceId: userId,
      detail: `Updated login email for clinician ${clinician.fullName || id}`,
      before: { email: before?.email },
      after: { email: newEmail },
    });

    res.json({
      user: { id: updated._id, email: updated.email },
      loginEmail: updated.email,
    });
  } catch (err) {
    next(err);
  }
};

export const resetClinicianUserPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = validateId(req.params.id);
    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const userId = toId(clinician.user || clinician.userId);
    if (!userId) return res.status(400).json({ message: "No login account linked to this clinician" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const tempPassword = crypto.randomBytes(6).toString("base64url").slice(0, 10);
    await User.findByIdAndUpdate(userId, {
      password: tempPassword,
      mustChangePassword: true,
    });

    try {
      await sendWelcomeEmail({
        name: user.name || user.fullName || clinician.fullName,
        email: user.email,
        password: tempPassword,
        role: user.role,
      });
    } catch (mailErr) {
      // @ts-ignore
      console.warn("[resetClinicianUserPassword] email failed:", mailErr.message);
    }

    await logAudit(req, "RESET_CLINICIAN_LOGIN_PASSWORD", "User", {
      resourceId: userId,
      detail: `Reset password for clinician ${clinician.fullName || id}`,
    });

    res.json({
      success: true,
      message: "Temporary password sent to clinician email.",
      email: user.email,
    });
  } catch (err) {
    next(err);
  }
};