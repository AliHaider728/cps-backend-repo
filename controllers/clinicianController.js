/**
 * controllers/clinicianController.js — Module 3
 *
 * Endpoints (mounted at /api/clinicians by routes/clinicianRoutes.js):
 *   GET    /                      → list with filters
 *   POST   /                      → create
 *   GET    /:id                   → detail
 *   PUT    /:id                   → update
 *   DELETE /:id                   → delete (admin)
 *   GET    /:id/client-history    → past/current PCN+practice assignments
 *   PATCH  /:id/restrict          → set isRestricted=true (+reason)
 *   PATCH  /:id/unrestrict        → set isRestricted=false
 *
 * All mutations call logAudit(...).
 */

import Clinician               from "../models/Clinician.js";
import ClinicianClientHistory  from "../models/ClinicianClientHistory.js";
import ClinicianLeaveEntry     from "../models/ClinicianLeaveEntry.js";
import User                    from "../models/User.js";
import { logAudit }            from "../middleware/auditLogger.js";
import { normalizeId }         from "../lib/ids.js";
import { calcAllBalances }     from "../lib/leaveCalc.js";

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

    if (type)        docs = docs.filter((d) => d.clinicianType === type);
    if (contract)    docs = docs.filter((d) => d.contractType === contract);
    if (opsLead)     docs = docs.filter((d) => String(d.opsLead) === String(opsLead));
    if (supervisor)  docs = docs.filter((d) => String(d.supervisor) === String(supervisor));

    if (typeof restricted !== "undefined" && restricted !== "")
      docs = docs.filter((d) => Boolean(d.isRestricted) === (restricted === "true"));

    if (typeof active !== "undefined" && active !== "")
      docs = docs.filter((d) => Boolean(d.isActive) === (active === "true"));

    docs = docs.filter((d) => matchesSearch(d, search));

    // Enrich with leave balance + ops/supervisor names (cheap aggregation)
    const userIds = new Set();
    docs.forEach((d) => {
      if (d.opsLead)    userIds.add(String(d.opsLead));
      if (d.supervisor) userIds.add(String(d.supervisor));
    });

    const users = userIds.size
      ? await User.find({}).lean()
      : [];
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
    const payload = { ...req.body, createdBy: req.user?._id || null };
    const created = await Clinician.create(payload);

    await logAudit(req, "CREATE_CLINICIAN", "Clinician", {
      resourceId: created._id,
      detail: `Created clinician "${created.fullName || created.email || created._id}"`,
      after:  safeJson(created),
    });

    res.status(201).json({ clinician: created });
  } catch (err) {
    next(err);
  }
};

/* ─── DETAIL ─────────────────────────────────────────────── */
export const getClinicianById = async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const clinician = await Clinician.findById(id)
      .populate("opsLead", "fullName email role")
      .populate("supervisor", "fullName email role")
      .populate("user", "fullName email role")
      .lean();

    if (!clinician)
      return res.status(404).json({ message: "Clinician not found" });

    const leaveEntries = await ClinicianLeaveEntry.find({ clinician: id }).lean();
    const leaveBalances = calcAllBalances(leaveEntries);

    res.json({ clinician: { ...clinician, leaveBalances } });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateClinician = async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    // Selective merge — never wipe nested objects when client omits them
    const body = { ...req.body };
    delete body._id;
    delete body.createdAt;

    const updated = await Clinician.findByIdAndUpdate(id, body, { new: true });

    await logAudit(req, "UPDATE_CLINICIAN", "Clinician", {
      resourceId: id,
      detail: `Updated clinician "${updated?.fullName || id}"`,
      before: safeJson(before),
      after:  safeJson(updated),
    });

    res.json({ clinician: updated });
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

/* ─── CLIENT HISTORY (read only) ─────────────────────────── */
export const getClientHistory = async (req, res, next) => {
  try {
    const id = validateId(req.params.id);
    const rows = await ClinicianClientHistory.find({ clinician: id })
      .populate("pcn", "name")
      .populate("practice", "name")
      .lean();

    rows.sort((a, b) => {
      const aDate = new Date(a.startDate || 0).getTime();
      const bDate = new Date(b.startDate || 0).getTime();
      return bDate - aDate;
    });

    res.json({ history: rows });
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
