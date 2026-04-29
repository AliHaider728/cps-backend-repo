/**
 * controllers/cppeController.js — Module 3
 *
 * CPPE (Centre for Pharmacy Postgraduate Education) training tracker.
 * Status lives directly on the Clinician record (cppeStatus field).
 *
 * Endpoints under /api/clinicians/:id/cppe
 *   GET   → returns clinician.cppeStatus
 *   PUT   → updates clinician.cppeStatus
 */

import Clinician     from "../models/Clinician.js";
import { logAudit }  from "../middleware/auditLogger.js";
import { normalizeId } from "../lib/ids.js";

const safeJson = (v) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v) => normalizeId(v);

const DEFAULT_CPPE = {
  enrolled:    false,
  exempt:      false,
  completed:   false,
  enrolledAt:  null,
  completedAt: null,
  progressPct: 0,
  modules:     [],
  notes:       "",
};

const calcProgress = (modules = []) => {
  if (!modules.length) return 0;
  const done = modules.filter((m) => m?.status === "completed").length;
  return Math.round((done / modules.length) * 100);
};

/* ─── GET ────────────────────────────────────────────────── */
export const getCPPE = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    res.json({ cppe: { ...DEFAULT_CPPE, ...(clinician.cppeStatus || {}) } });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateCPPE = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const before = await Clinician.findById(id).lean();
    if (!before) return res.status(404).json({ message: "Clinician not found" });

    const incoming = req.body?.cppe || req.body || {};
    const merged   = { ...DEFAULT_CPPE, ...(before.cppeStatus || {}), ...incoming };

    // Auto-stamp dates when toggling
    if (incoming.enrolled === true && !before.cppeStatus?.enrolledAt) {
      merged.enrolledAt = new Date().toISOString();
    }
    if (incoming.completed === true && !before.cppeStatus?.completedAt) {
      merged.completedAt = new Date().toISOString();
    }
    if (Array.isArray(merged.modules) && merged.modules.length) {
      merged.progressPct = calcProgress(merged.modules);
    }

    const updated = await Clinician.findByIdAndUpdate(
      id,
      { cppeStatus: merged },
      { new: true }
    );

    await logAudit(req, "UPDATE_CLINICIAN_CPPE", "Clinician", {
      resourceId: id,
      detail: `Updated CPPE status for clinician "${before.fullName || id}"`,
      before: safeJson(before.cppeStatus),
      after:  safeJson(merged),
    });

    res.json({ cppe: updated.cppeStatus });
  } catch (err) {
    next(err);
  }
};
