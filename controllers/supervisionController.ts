/**
 * controllers/supervisionController.js — Module 3
 *
 * Endpoints under /api/clinicians/:id/supervision
 *   GET    /                → list logs
 *   POST   /                → add log
 *   PUT    /:logId          → update log
 *   DELETE /:logId          → delete (admin)
 */

import { Request, Response, NextFunction } from "express";
import ClinicianSupervisionLog from "../models/ClinicianSupervisionLog.js";
import Clinician               from "../models/Clinician.js";
import User                    from "../models/User.js";
import { logAudit }            from "../middleware/auditLogger.js";
import { normalizeId }         from "../lib/ids.js";
import { assertClinicianAccess } from "../lib/clinicianAccess.js";

const safeJson = (v: any) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v: any) => normalizeId(v);

/* ─── LIST ───────────────────────────────────────────────── */
export const getLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = await assertClinicianAccess(req, req.params.id as string);

    const logs: any[] = await ClinicianSupervisionLog.find({ clinician: id }).lean();

    const supervisorIds = new Set(
      logs.map((l: any) => String(l.supervisor || "")).filter(Boolean)
    );
    const users: any[] = supervisorIds.size ? await User.find({}).lean() : [];
    const userMap = new Map(users.map((u: any) => [String(u._id), u]));

    for (const log of logs) {
      const sup = userMap.get(String(log.supervisor));
      if (sup) {
        log.supervisor = {
          email: sup.email,
          fullName: sup.fullName || sup.name,
        };
      }
    }

    logs.sort((a, b) => new Date(b.sessionDate || 0).getTime() - new Date(a.sessionDate || 0).getTime());

    // Latest RAG colour for header chip on detail page
    const latestRag = logs[0]?.ragStatus || null;

    res.json({ logs, latestRag, total: logs.length });
  } catch (err) {
    next(err);
  }
};

/* ─── ADD ────────────────────────────────────────────────── */
export const addLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = toId(req.params.id as string);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician: any = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = req.body || {};
    const log = await ClinicianSupervisionLog.create({
      clinician:   id,
      sessionDate: body.sessionDate || new Date().toISOString().split("T")[0],
      ragStatus:   body.ragStatus   || "green",
      notes:       body.notes       || "",
      actionItems: Array.isArray(body.actionItems) ? body.actionItems : [],
      supervisor:  body.supervisor  || clinician.supervisor || (req as any).user?._id || null,
      createdBy:   (req as any).user?._id    || null,
    });

    await logAudit(req, "ADD_SUPERVISION_LOG", "ClinicianSupervisionLog", {
      resourceId: (log as any)._id,
      detail: `Added supervision log (RAG: ${(log as any).ragStatus}) for clinician ${id}`,
      after:  safeJson(log),
    });

    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id    = await assertClinicianAccess(req, req.params.id as string);
    const logId = toId(req.params.logId);
    if (!logId) return res.status(400).json({ message: "Invalid id" });

    const before: any = await ClinicianSupervisionLog.findById(logId).lean();
    if (!before) return res.status(404).json({ message: "Log not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Log does not belong to this clinician" });

    const isClinician = (req as any).user?.role === "clinician";
    let body = { ...req.body };
    delete body._id;

    if (isClinician) {
      if (before.reflectionSubmittedAt || before.reflection) {
        return res.status(400).json({ message: "Reflection already submitted and locked" });
      }
      body = {
        reflection: body.reflection,
        reflectionSubmittedAt: body.reflectionSubmittedAt || new Date().toISOString(),
        type: before.type || body.type || "remote",
      };
    }

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
export const deleteLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id    = toId(req.params.id as string);
    const logId = toId(req.params.logId);
    if (!id || !logId) return res.status(400).json({ message: "Invalid id" });

    const before: any = await ClinicianSupervisionLog.findById(logId).lean();
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
