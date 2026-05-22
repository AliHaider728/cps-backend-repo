/**
 * controllers/clinicianController.js — Module 3
 *
 * UPDATED: createClinician now also creates a user login account
 * when createLogin: true + email + password are passed in the body.
 * The user record uses role: "clinician" and links back to the
 * clinician record via clinicianId.
 */

import bcrypt                  from "bcryptjs";
import Clinician               from "../models/Clinician.js";
import ClinicianClientHistory  from "../models/ClinicianClientHistory.js";
import ClinicianLeaveEntry     from "../models/ClinicianLeaveEntry.js";
import User                    from "../models/User.js";
import { logAudit }            from "../middleware/auditLogger.js";
import { normalizeId }         from "../lib/ids.js";
import { calcAllBalances }     from "../lib/leaveCalc.js";
import { linkUserToClinician, unlinkUserFromClinician } from "../lib/clinicianLink.js";
import { sendWelcomeEmail }    from "../utils/sendEmail.js";
import { query }               from "../config/db.js";

/* ─── helpers ────────────────────────────────────────────── */
const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

const validateId = (id, label = "id") => {
  const v = toId(id);
  if (!v) {
    const e = new Error(`Invalid ${label}`);
    e.statusCode = 400;
    throw e;
  }
  return v;
};

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

/* ─── LIST ───────────────────────────────────────────────── */
export const getClinicians = async (req, res, next) => {
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

    if (type)       docs = docs.filter((d) => d.clinicianType === type);
    if (contract)   docs = docs.filter((d) => d.contractType === contract);
    if (opsLead)    docs = docs.filter((d) => String(d.opsLead) === String(opsLead));
    if (supervisor) docs = docs.filter((d) => String(d.supervisor) === String(supervisor));

    if (typeof restricted !== "undefined" && restricted !== "")
      docs = docs.filter((d) => Boolean(d.isRestricted) === (restricted === "true"));

    if (typeof active !== "undefined" && active !== "")
      docs = docs.filter((d) => Boolean(d.isActive) === (active === "true"));

    docs = docs.filter((d) => matchesSearch(d, search));

    const userIds = new Set();
    docs.forEach((d) => {
      if (d.opsLead)    userIds.add(String(d.opsLead));
      if (d.supervisor) userIds.add(String(d.supervisor));
    });

    const users = userIds.size ? await User.find({}).lean() : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const allLeave = await ClinicianLeaveEntry.find({}).lean();
    const leaveByClinician = new Map();
    for (const entry of allLeave) {
      const cid = String(entry.clinician || "");
      if (!cid) continue;
      if (!leaveByClinician.has(cid)) leaveByClinician.set(cid, []);
      leaveByClinician.get(cid).push(entry);
    }

    const enriched = docs.map((d) => {
      const balances = calcAllBalances(leaveByClinician.get(String(d._id)) || []);
      const primaryBalance = balances.find((b) => b.contract === d.contractType) || balances[0];
      return {
        ...d,
        opsLeadName:    userMap.get(String(d.opsLead))?.fullName || "",
        supervisorName: userMap.get(String(d.supervisor))?.fullName || "",
        alBalance:      primaryBalance,
        leaveBalances:  balances,
      };
    });

    enriched.sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || "")));

    res.json({ clinicians: enriched, total: enriched.length });
  } catch (err) {
    next(err);
  }
};

/* ─── CREATE ─────────────────────────────────────────────── */
export const createClinician = async (req, res, next) => {
  try {
    const {
      // Login account fields (optional) — stripped before clinician save
      createLogin,
      loginPassword,
      // Everything else goes to Clinician model
      ...clinicianData
    } = req.body;

    const payload = { ...clinicianData, createdBy: req.user?._id || null };
    const created = await Clinician.create(payload);

    // ── Optionally create a linked user login account ──────────────
    let userCreated = null;
    let userError   = null;

    const shouldCreate =
      createLogin === true ||
      createLogin === "true" ||
      createLogin === 1;

    if (shouldCreate && created.email && loginPassword) {
      try {
        const normalizedEmail = String(created.email).trim().toLowerCase();

        // Check for duplicate email in users
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
            clinicianId:        created._id,   // link back to Clinician record
            createdBy:          req.user?._id || null,
            lastLogin:          null,
            phone:              created.phone  || "",
            department:         "Clinical",
            jobTitle:           created.clinicianType || "Clinician",
            startDate:          created.startDate || null,
            emergencyContact:   { name: "", relationship: "", phone: "", email: "" },
          });

          // Send welcome email (non-blocking)
          try {
            await sendWelcomeEmail({
              name:     userCreated.name,
              email:    userCreated.email,
              password: loginPassword,
              role:     "clinician",
            });
          } catch (emailErr) {
            console.error("[createClinician EMAIL ERROR]", emailErr.message);
          }

          // Update clinician record with user link
          await Clinician.findByIdAndUpdate(created._id, { user: userCreated._id });
        }
      } catch (err) {
        console.error("[createClinician USER ERROR]", err.message);
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
export const getClinicianById = async (req, res, next) => {
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
export const linkClinicianUser = async (req, res, next) => {
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

    await logAudit(req, "CLINICIAN_USER_RELINKED", "Clinician", {
      resourceId: id,
      detail: `Linked clinician to user ${userId}`,
      after: { userId, clinicianId: id },
    });

    res.json({ clinician, linked: true, userId: String(userId) });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateClinician = async (req, res, next) => {
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
export const deleteClinician = async (req, res, next) => {
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
export const getClientHistory = async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const rows = await ClinicianClientHistory.find({ clinician: id })
      .populate("pcn",      "name")
      .populate("practice", "name")
      .lean();

    rows.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

    res.json({ history: rows });
  } catch (err) {
    next(err);
  }
};

/* ─── CLIENT HISTORY — ADD ───────────────────────────────── */
export const addClientHistory = async (req, res, next) => {
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
export const updateClientHistory = async (req, res, next) => {
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
export const updateSystemAccess = async (req, res, next) => {
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
export const restrictClinician = async (req, res, next) => {
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

export const unrestrictClinician = async (req, res, next) => {
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