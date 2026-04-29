/**
 * controllers/restrictedClinicianController.js — Module 3
 *
 * Manages per-client clinician restrictions.
 * A restriction here means a clinician CANNOT be placed at a specific
 * practice / PCN / surgery (separate from the global isRestricted flag).
 */

import RestrictedClinician from "../models/RestrictedClinician.js";
import Clinician from "../models/Clinician.js";
import { logAudit } from "../middleware/auditLogger.js";
import { normalizeId } from "../lib/ids.js";

const toId = (v) => normalizeId(v);
const safeJ = (v) => JSON.parse(JSON.stringify(v ?? null));

/* ─── LIST ALL ───────────────────────────────────────────── */
export const listAllRestricted = async (req, res, next) => {
  try {
    const { entityType, entityId, clinicianId, activeOnly = "true" } = req.query;
    let filter = {};
    if (activeOnly === "true") filter.isActive = true;
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = toId(entityId) || entityId;
    if (clinicianId) filter.clinician = toId(clinicianId) || clinicianId;

    const records = await RestrictedClinician.find(filter)
      .populate("clinician", "fullName email clinicianType gphcNumber")
      .populate("addedBy", "fullName email")
      .lean();

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};

/* ─── GET RESTRICTED CLIENTS FOR ONE CLINICIAN ───────────── */
export const getRestrictedClientsForClinician = async (req, res, next) => {
  try {
    const clinicianId = toId(req.params.id);
    if (!clinicianId) return res.status(400).json({ message: "Invalid clinician id" });

    const records = await RestrictedClinician.find({
      clinician: clinicianId,
      isActive: true,
    })
      .populate("addedBy", "fullName")
      .lean();

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};

/* ─── ADD PER-CLIENT RESTRICTION ────────────────────────── */
export const addRestrictedClient = async (req, res, next) => {
  try {
    const clinicianId = toId(req.params.id);
    if (!clinicianId) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(clinicianId).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const { entityType, entityId, reason, notes } = req.body || {};
    if (!entityType || !entityId) {
      return res.status(400).json({ message: "entityType and entityId are required" });
    }

    // Check for existing active restriction for same clinician + entity
    const existing = await RestrictedClinician.findOne({
      clinician: clinicianId,
      entityType,
      entityId: String(entityId),
      isActive: true,
    }).lean();

    if (existing) {
      return res.status(409).json({
        message:
          "An active restriction already exists for this clinician at this client",
        record: existing,
      });
    }

    const record = await RestrictedClinician.create({
      clinician: clinicianId,
      entityType: String(entityType),
      entityId: String(entityId),
      reason: String(reason || "").trim(),
      notes: String(notes || "").trim(),
      addedBy: req.user?._id || null,
      addedAt: new Date(),
      isActive: true,
    });

    await logAudit(req, "ADD_CLIENT_RESTRICTION", "RestrictedClinician", {
      resourceId: record._id,
      detail: `Restricted clinician "${clinician.fullName || clinicianId}" from ${entityType} ${entityId}`,
      after: safeJ(record),
    });

    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
};

/* ─── REMOVE PER-CLIENT RESTRICTION (soft delete) ────────── */
export const removeRestrictedClient = async (req, res, next) => {
  try {
    const clinicianId = toId(req.params.id);
    const recordId = toId(req.params.recordId);
    if (!clinicianId || !recordId)
      return res.status(400).json({ message: "Invalid id" });

    const before = await RestrictedClinician.findById(recordId).lean();
    if (!before)
      return res.status(404).json({ message: "Restriction record not found" });
    if (String(before.clinician) !== String(clinicianId)) {
      return res
        .status(403)
        .json({ message: "Record does not belong to this clinician" });
    }

    const { reason: removeReason } = req.body || {};

    const updated = await RestrictedClinician.findByIdAndUpdate(
      recordId,
      {
        isActive: false,
        removedAt: new Date(),
        removedBy: req.user?._id || null,
        removeReason: String(removeReason || "").trim(),
      },
      { new: true }
    );

    await logAudit(req, "REMOVE_CLIENT_RESTRICTION", "RestrictedClinician", {
      resourceId: recordId,
      detail: `Removed restriction for clinician from ${before.entityType} ${before.entityId}`,
      before: safeJ(before),
      after: safeJ(updated),
    });

    res.json({ ok: true, record: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── GET RESTRICTED CLINICIANS AT A CLIENT ──────────────── */
// Used by rota / bookings to show hard-block flags.
// Called from clientRoutes or clinicianRoutes — route decides the path.
export const getRestrictedAtClient = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    if (!entityType || !entityId) {
      return res
        .status(400)
        .json({ message: "entityType and entityId are required" });
    }

    const records = await RestrictedClinician.find({
      entityType,
      entityId: String(entityId),
      isActive: true,
    })
      .populate(
        "clinician",
        "fullName email clinicianType gphcNumber isRestricted"
      )
      .populate("addedBy", "fullName")
      .lean();

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};