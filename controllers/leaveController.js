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
import { validateAnnualLeaveBalance } from "../lib/leaveValidation.js";
import { query } from "../config/db.js";
import ClinicianSupervisionLog from "../models/ClinicianSupervisionLog.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

const eachDateISO = (startDate, endDate) => {
  const out = [];
  const d = new Date(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

const syncLeaveToRota = async ({ clinicianId, leaveType, startDate, endDate, actorId, sourceLeaveId }) => {
  const rotaStatus =
    leaveType === "annual" ? "annual_leave"
    : leaveType === "sick" ? "sick"
    : leaveType === "cppe" ? "cppe_training"
    : null;
  if (!rotaStatus) return;
  const dates = eachDateISO(startDate, endDate);
  const cid = String(clinicianId);
  for (const date of dates) {
    await query(
      `UPDATE shifts
       SET status = $1, hours = 0, source = $2, source_leave_id = $3, updated_at = NOW()
       WHERE TRIM(clinician_id::text) = TRIM($4) AND date = $5::date`,
      [rotaStatus, `${leaveType}_log`, sourceLeaveId || null, cid, date]
    );
    await query(
      `UPDATE rota_shifts
       SET shift_type = $1, expected_hours = 0, is_filled = false, updated_at = NOW()
       WHERE TRIM(clinician_id::text) = TRIM($2) AND shift_date = $3::date`,
      [rotaStatus, cid, date]
    );
    await query(
      `UPDATE timesheet_entries te
          SET expected_hours = 0,
              actual_hours = 0,
              notes = COALESCE(NULLIF(TRIM(te.notes), ''), '') || CASE WHEN TRIM(COALESCE(te.notes, '')) = '' THEN $1 ELSE ' | ' || $1 END,
              updated_at = NOW()
        FROM timesheets ts
       WHERE te.timesheet_id = ts.id
         AND TRIM(te.clinician_id::text) = TRIM($2)
         AND te.shift_date = $3::date
         AND ts.status IN ('draft', 'rejected')`,
      [`On ${leaveType} leave`, cid, date]
    );
  }
  if (leaveType === "annual") {
    const supervision = await ClinicianSupervisionLog.find({ clinician: clinicianId }).lean();
    const supervisionDates = new Set((supervision || []).map((s) => String(s.sessionDate || "").slice(0, 10)));
    const clashes = dates.filter((d) => supervisionDates.has(d));
    if (clashes.length > 0) {
      // Trainer alert + audit log marker
      await logAudit({ user: { _id: actorId, role: "system" } }, "LEAVE_SUPERVISION_CLASH_ALERT", "ClinicianLeaveEntry", {
        detail: `Annual leave clashes with supervision on ${clashes.join(", ")}`,
        after: { clinicianId, clashes, notifyTo: ["Stacey", "Sonia"] },
      });
    }
  }
};

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

    const leaveType = body.leaveType || "annual";
    const contract = body.contract || clinician.contractType || "ARRS";

    if (leaveType === "annual") {
      const existing = await ClinicianLeaveEntry.find({ clinician: id }).lean();
      const block = validateAnnualLeaveBalance(existing, {
        contract,
        startDate,
        endDate,
        days,
      });
      if (block.blocked) {
        return res.status(400).json({
          code: block.code,
          message: block.message,
          contractType: block.contractType,
          requestedDays: block.requestedDays,
          remainingDays: block.remainingDays,
        });
      }
    }

    const entry = await ClinicianLeaveEntry.create({
      clinician:  id,
      leaveType,
      contract,
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

    if (entry.approved) {
      await syncLeaveToRota({
        clinicianId: id,
        leaveType: entry.leaveType,
        startDate: entry.startDate,
        endDate: entry.endDate,
        actorId: req.user?._id || null,
        sourceLeaveId: entry._id,
      });
    }

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

    const leaveType = body.leaveType || before.leaveType || "annual";
    const contract = body.contract || before.contract || "ARRS";
    if (leaveType === "annual" && (body.days != null || body.startDate || body.endDate)) {
      const all = await ClinicianLeaveEntry.find({ clinician: id }).lean();
      const others = all.filter((e) => String(e._id) !== String(entryId));
      const block = validateAnnualLeaveBalance(others, {
        contract,
        startDate: body.startDate || before.startDate,
        endDate: body.endDate || before.endDate,
        days: body.days != null ? body.days : before.days,
      });
      if (block.blocked) {
        return res.status(400).json({
          code: block.code,
          message: block.message,
          contractType: block.contractType,
          requestedDays: block.requestedDays,
          remainingDays: block.remainingDays,
        });
      }
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

    if ((updated?.approved === true || updated?.approved === "true") && ["annual", "sick", "cppe"].includes(String(updated?.leaveType || ""))) {
      await syncLeaveToRota({
        clinicianId: id,
        leaveType: updated.leaveType,
        startDate: updated.startDate,
        endDate: updated.endDate,
        actorId: req.user?._id || null,
        sourceLeaveId: updated._id,
      });
    }

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
