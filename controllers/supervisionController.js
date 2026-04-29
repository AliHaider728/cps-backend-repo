/**
 * controllers/supervisionController.js — Module 3
 *
 * Endpoints under /api/clinicians/:id/supervision
 *   GET    /                → list logs
 *   POST   /                → add log
 *   PUT    /:logId          → update log
 *   DELETE /:logId          → delete (admin)
 */

import ClinicianSupervisionLog from "../models/ClinicianSupervisionLog.js";
import Clinician               from "../models/Clinician.js";
import { logAudit }            from "../middleware/auditLogger.js";
import { normalizeId }         from "../lib/ids.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

/* ─── LIST ───────────────────────────────────────────────── */
export const getLogs = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const logs = await ClinicianSupervisionLog.find({ clinician: id })
      .populate("supervisor", "fullName email")
      .lean();

    logs.sort((a, b) => new Date(b.sessionDate || 0) - new Date(a.sessionDate || 0));

    // Latest RAG colour for header chip on detail page
    const latestRag = logs[0]?.ragStatus || null;

    res.json({ logs, latestRag, total: logs.length });
  } catch (err) {
    next(err);
  }
};

/* ─── ADD ────────────────────────────────────────────────── */
export const addLog = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = req.body || {};
    const log = await ClinicianSupervisionLog.create({
      clinician:   id,
      sessionDate: body.sessionDate || new Date().toISOString().split("T")[0],
      ragStatus:   body.ragStatus   || "green",
      notes:       body.notes       || "",
      actionItems: Array.isArray(body.actionItems) ? body.actionItems : [],
      supervisor:  body.supervisor  || clinician.supervisor || req.user?._id || null,
      createdBy:   req.user?._id    || null,
    });

    await logAudit(req, "ADD_SUPERVISION_LOG", "ClinicianSupervisionLog", {
      resourceId: log._id,
      detail: `Added supervision log (RAG: ${log.ragStatus}) for clinician ${id}`,
      after:  safeJson(log),
    });

    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateLog = async (req, res, next) => {
  try {
    const id    = toId(req.params.id);
    const logId = toId(req.params.logId);
    if (!id || !logId) return res.status(400).json({ message: "Invalid id" });

    const before = await ClinicianSupervisionLog.findById(logId).lean();
    if (!before) return res.status(404).json({ message: "Log not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Log does not belong to this clinician" });

    const body = { ...req.body };
    delete body._id;

    const updated = await ClinicianSupervisionLog.findByIdAndUpdate(logId, body, { new: true });

    await logAudit(req, "UPDATE_SUPERVISION_LOG", "ClinicianSupervisionLog", {
      resourceId: logId,
      detail: `Updated supervision log for clinician ${id}`,
      before: safeJson(before),
      after:  safeJson(updated),
    });

    res.json({ log: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── DELETE ─────────────────────────────────────────────── */
export const deleteLog = async (req, res, next) => {
  try {
    const id    = toId(req.params.id);
    const logId = toId(req.params.logId);
    if (!id || !logId) return res.status(400).json({ message: "Invalid id" });

    const before = await ClinicianSupervisionLog.findById(logId).lean();
    if (!before) return res.status(404).json({ message: "Log not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Log does not belong to this clinician" });

    await ClinicianSupervisionLog.findByIdAndDelete(logId);

    await logAudit(req, "DELETE_SUPERVISION_LOG", "ClinicianSupervisionLog", {
      resourceId: logId,
      detail: `Deleted supervision log for clinician ${id}`,
      before: safeJson(before),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
