/**
 * Admin leave queue — uses ClinicianLeaveEntry (app_records), not SQL leave_requests.
 */
import Clinician from "../models/Clinician.js";
import ClinicianLeaveEntry from "../models/ClinicianLeaveEntry.js";
import User from "../models/User.js";
import { logAudit } from "../middleware/auditLogger.js";
import { calcAllBalances, dayCount } from "../lib/leaveCalc.js";
import { syncLeaveToRota } from "./leaveController.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));

const enrichEntries = async (entries) => {
  const clinicianIds = [...new Set(entries.map((e) => String(e.clinician)))];
  const clinicians = clinicianIds.length
    ? await Clinician.find({}).lean().then((all) =>
        all.filter((c) => clinicianIds.includes(String(c._id)))
      )
    : [];
  const clinMap = new Map(clinicians.map((c) => [String(c._id), c]));

  const approverIds = new Set(
    entries.map((e) => e.approvedBy).filter(Boolean).map(String)
  );
  const users = approverIds.size ? await User.find({}).lean() : [];
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return entries.map((e) => {
    const c = clinMap.get(String(e.clinician));
    const approver = userMap.get(String(e.approvedBy));
    return {
      ...e,
      clinicianName: c?.fullName || "—",
      contractType: e.contract || c?.contractType || "—",
      approverEmail: approver?.email || "",
      days: e.days ?? dayCount(e.startDate, e.endDate),
    };
  });
};

export const listAdminLeaves = async (req, res, next) => {
  try {
    const status = String(req.query.status || "pending").toLowerCase();
    let entries = await ClinicianLeaveEntry.find({}).lean();

    if (status === "pending") {
      entries = entries.filter((e) => e.approved !== true);
    } else if (status === "approved") {
      entries = entries.filter((e) => e.approved === true);
    } else if (status === "rejected") {
      entries = entries.filter((e) => e.rejected === true);
    }

    entries.sort((a, b) => {
      const da = new Date(a.createdAt || a.startDate || 0);
      const db = new Date(b.createdAt || b.startDate || 0);
      return status === "approved" ? db - da : da - db;
    });

    const month = req.query.month;
    const year = req.query.year;
    if (month && year) {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const endMonth = Number(month) === 12 ? 1 : Number(month) + 1;
      const endYear = Number(month) === 12 ? Number(year) + 1 : Number(year);
      const end = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
      entries = entries.filter(
        (e) => String(e.startDate || "") >= start && String(e.startDate || "") < end
      );
    }

    const search = String(req.query.search || "").toLowerCase().trim();
    const enriched = await enrichEntries(entries);
    const filtered = search
      ? enriched.filter((e) =>
          String(e.clinicianName || "").toLowerCase().includes(search)
        )
      : enriched;

    res.json({ leaves: filtered, total: filtered.length });
  } catch (err) {
    next(err);
  }
};

export const reviewLeave = async (req, res, next) => {
  try {
    const leaveId = req.params.id;
    const action = String(req.body?.action || "").toLowerCase();
    const rejectionNote = String(req.body?.rejection_note || req.body?.rejectionNote || "").trim();

    const before = await ClinicianLeaveEntry.findById(leaveId).lean();
    if (!before) return res.status(404).json({ message: "Leave request not found" });
    if (before.approved === true && action === "approve") {
      return res.status(400).json({ message: "Already approved" });
    }

    if (action === "reject") {
      const updated = await ClinicianLeaveEntry.findByIdAndUpdate(
        leaveId,
        {
          approved: false,
          rejected: true,
          rejectionNote,
          approvedBy: req.user?._id || null,
          approvedAt: new Date().toISOString(),
        },
        { new: true }
      );
      await logAudit(req, "REJECT_LEAVE", "ClinicianLeaveEntry", {
        resourceId: leaveId,
        detail: `Rejected leave for clinician ${before.clinician}`,
        after: safeJson(updated),
      });
      return res.json({ leave: updated });
    }

    if (action !== "approve") {
      return res.status(400).json({ message: "action must be approve or reject" });
    }

    const updated = await ClinicianLeaveEntry.findByIdAndUpdate(
      leaveId,
      {
        approved: true,
        rejected: false,
        rejectionNote: "",
        approvedBy: req.user?._id || null,
        approvedAt: new Date().toISOString(),
      },
      { new: true }
    );

    if (updated.leaveType === "annual" || !updated.leaveType) {
      await syncLeaveToRota({
        clinicianId: updated.clinician,
        leaveType: "annual",
        startDate: updated.startDate,
        endDate: updated.endDate,
        actorId: req.user?._id,
        sourceLeaveId: leaveId,
      });
    } else if (updated.leaveType === "sick") {
      await syncLeaveToRota({
        clinicianId: updated.clinician,
        leaveType: "sick",
        startDate: updated.startDate,
        endDate: updated.endDate,
        actorId: req.user?._id,
        sourceLeaveId: leaveId,
      });
    } else if (updated.leaveType === "cppe") {
      await syncLeaveToRota({
        clinicianId: updated.clinician,
        leaveType: "cppe",
        startDate: updated.startDate,
        endDate: updated.endDate,
        actorId: req.user?._id,
        sourceLeaveId: leaveId,
      });
    }

    await logAudit(req, "APPROVE_LEAVE", "ClinicianLeaveEntry", {
      resourceId: leaveId,
      detail: `Approved leave for clinician ${before.clinician}`,
      after: safeJson(updated),
    });

    res.json({ leave: updated });
  } catch (err) {
    next(err);
  }
};

export const getLeaveReport = async (req, res, next) => {
  try {
    const clinicians = await Clinician.find({}).lean();
    const allLeave = await ClinicianLeaveEntry.find({}).lean();

    const byClinician = new Map();
    for (const e of allLeave) {
      const cid = String(e.clinician);
      if (!byClinician.has(cid)) byClinician.set(cid, []);
      byClinician.get(cid).push(e);
    }

    const rows = [];
    for (const c of clinicians) {
      const entries = byClinician.get(String(c._id)) || [];
      const balances = calcAllBalances(entries);

      for (const b of balances) {
        const contract = b.contract;
        const annual = entries.filter(
          (e) => e.contract === contract && e.leaveType === "annual"
        );
        const pending = annual
          .filter((e) => e.approved !== true && e.rejected !== true)
          .reduce((s, e) => s + Number(e.days || 0), 0);
        const approved = annual
          .filter((e) => e.approved === true)
          .reduce((s, e) => s + Number(e.days || 0), 0);
        const rejected = annual
          .filter((e) => e.rejected === true)
          .reduce((s, e) => s + Number(e.days || 0), 0);

        rows.push({
          employee_name: c.fullName || "—",
          department: c.contractType || "—",
          project_name: contract,
          type_of_leave: "Annual Leave",
          entitlement_start_date: c.startDate ? String(c.startDate).slice(0, 10) : "",
          entitlement_end_date: c.endDate ? String(c.endDate).slice(0, 10) : "",
          al_entitlement: b.total,
          al_pending: pending,
          al_approved: approved,
          al_remaining: b.remaining,
          al_rejected: rejected,
          al_cancelled: 0,
        });
      }
    }

    rows.sort((a, b) =>
      String(a.employee_name).localeCompare(String(b.employee_name)) ||
      String(a.project_name).localeCompare(String(b.project_name))
    );

    res.json({ rows, total: rows.length });
  } catch (err) {
    next(err);
  }
};
