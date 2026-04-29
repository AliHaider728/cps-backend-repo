/**
 * controllers/scopeController.js — Module 3
 *
 * Handles Tab 9 — Scope of Practice.
 * Manages workstreams, systems in use, shadowing availability.
 *
 * Routes (add to clinicianRoutes.js):
 *   GET   /api/clinicians/:id/scope   → getScope
 *   PUT   /api/clinicians/:id/scope   → updateScope
 */

import ClinicianScopeOfPractice from "../models/ClinicianScopeOfPractice.js";
import Clinician                from "../models/Clinician.js";
import { logAudit }             from "../middleware/auditLogger.js";
import { normalizeId }          from "../lib/ids.js";

const toId  = (v) => normalizeId(v);
const safeJ = (v) => JSON.parse(JSON.stringify(v ?? null));

/* ─── GET ────────────────────────────────────────────────── */
export const getScope = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    // Upsert pattern — create an empty record if none exists yet
    let scope = await ClinicianScopeOfPractice.findOne({ clinician: id }).lean();
    if (!scope) {
      scope = await ClinicianScopeOfPractice.create({ clinician: id });
      scope = scope.toObject ? scope.toObject() : scope;
    }

    // Also pull the denormalised fields off the Clinician doc for the UI
    const clinician = await Clinician.findById(id)
      .select("scopeWorkstreams systemsInUse shadowingAvailable")
      .lean();

    res.json({
      scope,
      // Quick-access denormalised fields from the Clinician record
      scopeWorkstreams:   clinician?.scopeWorkstreams   || [],
      systemsInUse:       clinician?.systemsInUse       || [],
      shadowingAvailable: clinician?.shadowingAvailable || false,
    });
  } catch (err) {
    next(err);
  }
};

/* ─── UPDATE ─────────────────────────────────────────────── */
export const updateScope = async (req, res, next) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = { ...req.body };
    delete body._id;
    delete body.clinician;

    // Extract fields that live on Clinician doc (denormalised fast-access)
    const { workstreams, systemsInUse, shadowingAvailable, shadowingNotes, notes } = body;

    // 1. Update detailed scope record
    const before = await ClinicianScopeOfPractice.findOne({ clinician: id }).lean();

    const scopeUpdate = {
      ...(workstreams        !== undefined && { workstreams }),
      ...(systemsInUse       !== undefined && { systemsInUse }),
      ...(shadowingAvailable !== undefined && { shadowingAvailable }),
      ...(shadowingNotes     !== undefined && { shadowingNotes }),
      ...(notes              !== undefined && { notes }),
      updatedBy: req.user?._id || null,
    };

    const scope = await ClinicianScopeOfPractice.findOneAndUpdate(
      { clinician: id },
      { ...scopeUpdate, clinician: id },
      { new: true, upsert: true }
    );

    // 2. Keep Clinician's denormalised fields in sync
    const clinicianPatch = {};
    if (workstreams        !== undefined) {
      // scopeWorkstreams on Clinician is a flat string array, extract names
      clinicianPatch.scopeWorkstreams = Array.isArray(workstreams)
        ? workstreams.map((w) => w?.name || w).filter(Boolean)
        : [];
    }
    if (systemsInUse       !== undefined) {
      clinicianPatch.systemsInUse = Array.isArray(systemsInUse)
        ? systemsInUse.map((s) => s?.name || s).filter(Boolean)
        : [];
    }
    if (shadowingAvailable !== undefined) {
      clinicianPatch.shadowingAvailable = Boolean(shadowingAvailable);
    }

    if (Object.keys(clinicianPatch).length) {
      await Clinician.findByIdAndUpdate(id, clinicianPatch);
    }

    await logAudit(req, "UPDATE_SCOPE_OF_PRACTICE", "ClinicianScopeOfPractice", {
      resourceId: scope._id,
      detail:     `Updated scope of practice for clinician "${clinician.fullName || id}"`,
      before:     safeJ(before),
      after:      safeJ(scope),
    });

    res.json({ scope });
  } catch (err) {
    next(err);
  }
};