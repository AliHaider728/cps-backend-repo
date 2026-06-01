import EnterMyHoursEntry from "../models/EnterMyHoursEntry.js";
import { resolveClinicianIdForUser } from "../lib/clinicianLink.js";

const MANAGER_ROLES = ["super_admin", "ops_manager", "workforce", "director", "finance"];

const parseTime = (val) => {
  if (!val) return null;
  const s = String(val).slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m, str: s };
};

const calcWorkedHours = (startTime, endTime, breakMinutes = 0) => {
  const s = parseTime(startTime);
  const e = parseTime(endTime);
  if (!s || !e) return null;
  const diff = e.h * 60 + e.m - (s.h * 60 + s.m) - Number(breakMinutes || 0);
  if (diff < 0) return null;
  return Math.round((diff / 60) * 100) / 100;
};

const monthYearFromDate = (dateWorked) => {
  const d = new Date(`${String(dateWorked).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { month: null, year: null };
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

export async function getMyEnterHours(req, res, next) {
  try {
    const clinicianId = await resolveClinicianIdForUser(req.user);
    if (!clinicianId) {
      return res.status(404).json({ message: "No clinician profile linked to your account." });
    }

    const month = Number(req.query.month || 0) || null;
    const year = Number(req.query.year || 0) || null;

    let entries = await EnterMyHoursEntry.find({ clinician: clinicianId }).lean();
    if (month && year) entries = entries.filter((e) => Number(e.month) === month && Number(e.year) === year);
    entries.sort((a, b) => String(b.dateWorked || "").localeCompare(String(a.dateWorked || "")));

    return res.json({ entries });
  } catch (err) {
    return next(err);
  }
}

export async function upsertMyEnterHours(req, res, next) {
  try {
    const clinicianId = await resolveClinicianIdForUser(req.user);
    if (!clinicianId) {
      return res.status(404).json({ message: "No clinician profile linked to your account." });
    }

    const {
      entryId,
      practiceId = "",
      practiceName = "",
      pcn = "",
      assignedShiftRef = "",
      shiftId = "",
      dateWorked,
      startTime = "",
      endTime = "",
      breakDurationMinutes = 0,
      notes = "",
    } = req.body || {};

    if (!dateWorked || !shiftId) {
      return res.status(400).json({ message: "dateWorked and shiftId are required." });
    }

    const totalWorkedHours = calcWorkedHours(startTime, endTime, breakDurationMinutes);
    if (totalWorkedHours == null) {
      return res.status(400).json({ message: "Invalid start/end/break values." });
    }

    const { month, year } = monthYearFromDate(dateWorked);
    const payload = {
      clinician: clinicianId,
      practiceId,
      practiceName,
      pcn,
      assignedShiftRef: assignedShiftRef || shiftId,
      shiftId,
      dateWorked: String(dateWorked).slice(0, 10),
      startTime: String(startTime).slice(0, 5),
      endTime: String(endTime).slice(0, 5),
      breakDurationMinutes: Number(breakDurationMinutes || 0),
      totalWorkedHours,
      notes,
      month,
      year,
      managerApprovalStatus: "pending",
      rejectionReason: "",
      createdBy: req.user?._id || req.user?.id || null,
    };

    let entry = null;
    if (entryId) {
      const existing = await EnterMyHoursEntry.findById(entryId).lean();
      if (!existing || String(existing.clinician) !== String(clinicianId)) {
        return res.status(404).json({ message: "Entry not found." });
      }
      if (existing.submissionStatus === "submitted" && existing.managerApprovalStatus === "approved") {
        return res.status(409).json({ message: "Approved entry cannot be edited." });
      }
      entry = await EnterMyHoursEntry.findByIdAndUpdate(entryId, payload, { new: true });
    } else {
      const existingRows = await EnterMyHoursEntry.find({
        clinician: clinicianId,
        shiftId,
        dateWorked: String(dateWorked).slice(0, 10),
      }).lean();
      if (existingRows.length > 0) {
        entry = await EnterMyHoursEntry.findByIdAndUpdate(existingRows[0]._id, payload, { new: true });
      } else {
        entry = await EnterMyHoursEntry.create(payload);
      }
    }

    return res.json({ message: "Hours saved.", entry });
  } catch (err) {
    return next(err);
  }
}

export async function submitMyEnterHours(req, res, next) {
  try {
    const clinicianId = await resolveClinicianIdForUser(req.user);
    if (!clinicianId) {
      return res.status(404).json({ message: "No clinician profile linked to your account." });
    }

    const month = Number(req.body?.month || 0);
    const year = Number(req.body?.year || 0);
    if (!month || !year) return res.status(400).json({ message: "month and year are required." });

    const entries = await EnterMyHoursEntry.find({ clinician: clinicianId, month, year }).lean();
    if (!entries.length) return res.status(400).json({ message: "No hours to submit for selected month." });

    for (const entry of entries) {
      await EnterMyHoursEntry.findByIdAndUpdate(
        entry._id,
        {
          submissionStatus: "submitted",
          managerApprovalStatus: "pending",
          rejectionReason: "",
        },
        { new: true }
      );
    }

    return res.json({ message: "Hours submitted for manager approval." });
  } catch (err) {
    return next(err);
  }
}

export async function listManagerEnterHours(req, res, next) {
  try {
    const role = req.user?.role;
    if (!MANAGER_ROLES.includes(role)) {
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    }
    const month = Number(req.query.month || 0) || null;
    const year = Number(req.query.year || 0) || null;
    const status = String(req.query.status || "").trim();

    let entries = await EnterMyHoursEntry.find({ submissionStatus: "submitted" }).lean();
    if (month && year) entries = entries.filter((e) => Number(e.month) === month && Number(e.year) === year);
    if (status) entries = entries.filter((e) => String(e.managerApprovalStatus) === status);
    entries.sort((a, b) => String(b.dateWorked || "").localeCompare(String(a.dateWorked || "")));

    return res.json({ entries });
  } catch (err) {
    return next(err);
  }
}

export async function reviewManagerEnterHours(req, res, next) {
  try {
    const role = req.user?.role;
    if (!MANAGER_ROLES.includes(role)) {
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    }

    const { action, reason = "" } = req.body || {};
    const entry = await EnterMyHoursEntry.findById(req.params.id).lean();
    if (!entry) return res.status(404).json({ message: "Entry not found." });

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be approve or reject." });
    }
    if (action === "reject" && !String(reason).trim()) {
      return res.status(400).json({ message: "reason is required for rejection." });
    }

    const updated = await EnterMyHoursEntry.findByIdAndUpdate(
      entry._id,
      {
        managerApprovalStatus: action === "approve" ? "approved" : "rejected",
        rejectionReason: action === "reject" ? String(reason).trim() : "",
        reviewedBy: req.user?._id || req.user?.id || null,
        reviewedAt: new Date().toISOString(),
      },
      { new: true }
    );

    return res.json({ message: `Entry ${action}d.`, entry: updated });
  } catch (err) {
    return next(err);
  }
}

