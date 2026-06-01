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
import { resolveClinicianIdForUser } from "../lib/clinicianLink.js";
import { assertClinicianAccess } from "../lib/clinicianAccess.js";
import User from "../models/User.js";
import { v4 as uuidv4 } from "uuid";

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

const inDateRange = (iso, from, to) => {
  const d = String(iso || "").slice(0, 10);
  return d >= from && d <= to;
};

async function createNotificationAndActionItems({
  clinician,
  stakeholders,
  dates,
  meetings,
  leaveType,
  actorId,
  sourceLeaveId,
}) {
  if (!stakeholders.length) return;
  const clinicianName = clinician?.fullName || clinician?.email || "Clinician";
  const dateSummary = dates.join(", ");
  const actionText =
    leaveType === "sick"
      ? `Absence cover/reschedule needed for ${clinicianName} (${dateSummary}).`
      : `Leave impact review needed for ${clinicianName} (${dateSummary}).`;

  for (const user of stakeholders) {
    await query(
      `INSERT INTO app_records (model, id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
      [
        "notification",
        uuidv4(),
        JSON.stringify({
          type: "absence_alert",
          userId: user._id,
          clinicianId: clinician?._id || null,
          clinicianName,
          leaveType,
          dates,
          meetingCount: meetings.length,
          message: `${clinicianName} marked ${leaveType} absent. Please review supervision/ops schedule.`,
          sourceLeaveId: sourceLeaveId || null,
          read: false,
          createdBy: actorId || null,
          createdAt: new Date().toISOString(),
        }),
      ]
    );

    await query(
      `INSERT INTO app_records (model, id, data, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
      [
        "action_item",
        uuidv4(),
        JSON.stringify({
          ownerId: user._id,
          ownerRole: user.role || "",
          clinicianId: clinician?._id || null,
          title: "Absence follow-up required",
          detail: actionText,
          dueDate: dates[0] || null,
          status: "open",
          source: "leave_absence_workflow",
          sourceLeaveId: sourceLeaveId || null,
          meetingCount: meetings.length,
          createdBy: actorId || null,
          createdAt: new Date().toISOString(),
        }),
      ]
    );
  }
}

export const syncLeaveToRota = async ({ clinicianId, leaveType, startDate, endDate, actorId, sourceLeaveId }) => {
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

  // CPS rule: when clinician is absent (especially sickness), notify relevant SLT hosts
  if (leaveType === "sick") {
    const rangeDates = eachDateISO(startDate, endDate);
    const from = rangeDates[0];
    const to = rangeDates[rangeDates.length - 1];

    const clinician = await Clinician.findById(clinicianId).lean();
    const meetings = await ClinicianSupervisionLog.find({ clinician: clinicianId }).lean();
    const impactedMeetings = (meetings || []).filter((m) =>
      inDateRange(m.sessionDate, from, to)
    );

    const stakeholderIds = new Set();
    impactedMeetings.forEach((m) => {
      if (m.supervisor) stakeholderIds.add(String(m.supervisor));
    });
    if (clinician?.supervisor) stakeholderIds.add(String(clinician.supervisor));
    if (clinician?.opsLead) stakeholderIds.add(String(clinician.opsLead));

    const roleStakeholders = await User.find({}).lean();
    roleStakeholders
      .filter((u) => ["ops_manager", "training", "super_admin"].includes(String(u.role || "")))
      .forEach((u) => stakeholderIds.add(String(u._id)));

    const stakeholders = roleStakeholders.filter((u) => stakeholderIds.has(String(u._id)));
    await createNotificationAndActionItems({
      clinician,
      stakeholders,
      dates: rangeDates,
      meetings: impactedMeetings,
      leaveType,
      actorId,
      sourceLeaveId,
    });

    await logAudit({ user: { _id: actorId, role: "system" } }, "ABSENCE_NOTIFICATION_TRIGGERED", "ClinicianLeaveEntry", {
      resourceId: sourceLeaveId || null,
      detail: `Absence workflow triggered for clinician ${clinicianId}`,
      after: {
        clinicianId,
        leaveType,
        startDate,
        endDate,
        notifiedUsers: stakeholders.map((u) => ({ id: u._id, role: u.role, email: u.email })),
        impactedMeetings: impactedMeetings.map((m) => ({
          id: m._id,
          sessionDate: m.sessionDate,
          supervisor: m.supervisor || null,
        })),
      },
    });
  }
};

const loadLeavePayload = async (id) => {
  const clinician = await Clinician.findById(id).lean();
  if (!clinician) return null;
  const entries = await ClinicianLeaveEntry.find({ clinician: id }).lean();
  entries.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));
  return {
    entries,
    balances: calcAllBalances(entries),
    other: calcOtherLeave(entries),
  };
};

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const a0 = String(aStart || "").slice(0, 10);
  const a1 = String(aEnd || aStart || "").slice(0, 10);
  const b0 = String(bStart || "").slice(0, 10);
  const b1 = String(bEnd || bStart || "").slice(0, 10);
  return a0 <= b1 && b0 <= a1;
};

const hasApprovedLeaveClash = async (clinicianId, startDate, endDate) => {
  const all = await ClinicianLeaveEntry.find({ approved: true, leaveType: "annual" }).lean();
  return all.some(
    (e) =>
      String(e.clinician) !== String(clinicianId) &&
      rangesOverlap(e.startDate, e.endDate, startDate, endDate)
  );
};

/* ─── SELF (clinician portal) ────────────────────────────── */
export const getMyLeave = async (req, res, next) => {
  try {
    const id = await resolveClinicianIdForUser(req.user);
    if (!id) {
      return res.status(404).json({
        message: "No clinician profile linked to your account. Contact admin.",
      });
    }
    const payload = await loadLeavePayload(id);
    if (!payload) return res.status(404).json({ message: "Clinician not found" });
    res.json({ ...payload, clinicianId: id });
  } catch (err) {
    next(err);
  }
};

/* ─── LIST ───────────────────────────────────────────────── */
export const getLeave = async (req, res, next) => {
  try {
    const id = await assertClinicianAccess(req, req.params.id);
    const payload = await loadLeavePayload(id);
    if (!payload) return res.status(404).json({ message: "Clinician not found" });
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

/* ─── ADD ────────────────────────────────────────────────── */
export const addLeave = async (req, res, next) => {
  try {
    const id = await assertClinicianAccess(req, req.params.id);

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

    const leaveTypeMap = {
      "Annual Leave": "annual",
      annual: "annual",
      Sick: "sick",
      sick: "sick",
      CPPE: "cppe",
      cppe: "cppe",
      "Training Leave": "other",
      other: "other",
    };
    const leaveType = leaveTypeMap[body.leaveType] || body.leaveType || "annual";
    const contract = body.contract || body.contractType || clinician.contractType || "ARRS";

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

    const adminApproved =
      body.approved === true ||
      body.approved === "true" ||
      ["super_admin", "director", "ops_manager"].includes(req.user?.role);

    const twoWeeksDays = 10;
    const autoApprove =
      !adminApproved &&
      leaveType === "annual" &&
      days <= twoWeeksDays &&
      !(await hasApprovedLeaveClash(id, startDate, endDate));

    const approved = adminApproved || autoApprove;

    const entry = await ClinicianLeaveEntry.create({
      clinician:  id,
      leaveType,
      contract,
      startDate,
      endDate,
      days,
      approved,
      rejected: false,
      approvedBy: approved ? (req.user?._id || null) : null,
      approvedAt: approved ? new Date().toISOString() : null,
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
      autoApproved: autoApprove,
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
