/**
 * controllers/leaveController.js — Module 3
 *
 * Endpoints under /api/clinicians/:id/leave
 *   GET    /                → entries + balances per contract
 *   POST   /                → add entry  (auto-calc days when not supplied)
 *   PUT    /:entryId        → update / approve
 *   DELETE /:entryId        → delete
 */

import ClinicianLeaveEntry from "../models/ClinicianLeaveEntry.js";
import Clinician           from "../models/Clinician.js";
import { logAudit }        from "../middleware/auditLogger.js";
import { normalizeId }     from "../lib/ids.js";
import { calcAllBalances, calcOtherLeave, dayCount } from "../lib/leaveCalc.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

/* ─── LIST ───────────────────────────────────────────────── */
export const getLeave = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const entries = await ClinicianLeaveEntry.find({ clinician: id }).lean();
    entries.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

    res.json({
      entries,
      balances: calcAllBalances(entries),
      other:    calcOtherLeave(entries),
    });
  } catch (err) {
    next(err);
  }
};

/* ─── ADD ────────────────────────────────────────────────── */
export const addLeave = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = req.body || {};
    const startDate = body.startDate || null;
    const endDate   = body.endDate   || startDate;

    if (!startDate || !endDate)
      return res.status(400).json({ message: "startDate and endDate are required" });

    const days = body.days != null && body.days !== ""
      ? Number(body.days)
      : dayCount(startDate, endDate);

    const entry = await ClinicianLeaveEntry.create({
      clinician:  id,
      leaveType:  body.leaveType  || "annual",
      contract:   body.contract   || clinician.contractType || "ARRS",
      startDate,
      endDate,
      days,
      approved:   body.approved === true || body.approved === "true",
      approvedBy: (body.approved === true || body.approved === "true") ? (req.user?._id || null) : null,
      approvedAt: (body.approved === true || body.approved === "true") ? new Date().toISOString() : null,
      notes:      body.notes || "",
      createdBy:  req.user?._id || null,
    });

    await logAudit(req, "ADD_CLINICIAN_LEAVE", "ClinicianLeaveEntry", {
      resourceId: entry._id,
      detail: `Added ${entry.leaveType} leave (${entry.days} days, ${entry.contract}) for clinician ${id}`,
      after:  safeJson(entry),
    });

    const all = await ClinicianLeaveEntry.find({ clinician: id }).lean();

    res.status(201).json({
      entry,
      balances: calcAllBalances(all),
      other:    calcOtherLeave(all),
    });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateLeave = async (req, res, next) => {
  try {
    const id      = toId(req.params.id);
    const entryId = toId(req.params.entryId);
    if (!id || !entryId) return res.status(400).json({ message: "Invalid id" });

    const before = await ClinicianLeaveEntry.findById(entryId).lean();
    if (!before) return res.status(404).json({ message: "Leave entry not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Entry does not belong to this clinician" });

    const body = { ...req.body };
    delete body._id;

    if (body.startDate || body.endDate) {
      const s = body.startDate || before.startDate;
      const e = body.endDate   || before.endDate;
      if (body.days == null || body.days === "") body.days = dayCount(s, e);
    }

    const isApproving = (body.approved === true || body.approved === "true") && !before.approved;
    if (isApproving) {
      body.approvedBy = req.user?._id || null;
      body.approvedAt = new Date().toISOString();
    }

    const updated = await ClinicianLeaveEntry.findByIdAndUpdate(entryId, body, { new: true });

    await logAudit(req, "UPDATE_CLINICIAN_LEAVE", "ClinicianLeaveEntry", {
      resourceId: entryId,
      detail: `Updated leave entry for clinician ${id}${isApproving ? " (approved)" : ""}`,
      before: safeJson(before),
      after:  safeJson(updated),
    });

    const all = await ClinicianLeaveEntry.find({ clinician: id }).lean();
    res.json({
      entry: updated,
      balances: calcAllBalances(all),
      other:    calcOtherLeave(all),
    });
  } catch (err) {
    next(err);
  }
};

/* ─── DELETE ─────────────────────────────────────────────── */
export const deleteLeave = async (req, res, next) => {
  try {
    const id      = toId(req.params.id);
    const entryId = toId(req.params.entryId);
    if (!id || !entryId) return res.status(400).json({ message: "Invalid id" });

    const before = await ClinicianLeaveEntry.findById(entryId).lean();
    if (!before) return res.status(404).json({ message: "Leave entry not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Entry does not belong to this clinician" });

    await ClinicianLeaveEntry.findByIdAndDelete(entryId);

    await logAudit(req, "DELETE_CLINICIAN_LEAVE", "ClinicianLeaveEntry", {
      resourceId: entryId,
      detail: `Deleted leave entry (${before.leaveType}, ${before.days} days) for clinician ${id}`,
      before: safeJson(before),
    });

    const all = await ClinicianLeaveEntry.find({ clinician: id }).lean();
    res.json({
      ok: true,
      balances: calcAllBalances(all),
      other:    calcOtherLeave(all),
    });
  } catch (err) {
    next(err);
  }
};
