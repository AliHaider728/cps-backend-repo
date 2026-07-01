/**
 * controllers/restrictedClinicianController.js — Module 3
 *
 * Per-client clinician restrictions (separate from global isRestricted flag).
 * A row = "clinician X cannot be placed at client Y".
 *
 * Endpoints (mounted at /api/restricted-clinicians):
 *   GET    /                                          → list all active restrictions
 *   GET    /clinician/:id/restricted-clients          → clients this clinician is blocked from
 *   POST   /clinician/:id/restricted-clients          → add a per-client restriction
 *   DELETE /clinician/:id/restricted-clients/:recordId → soft-remove a restriction
 *   GET    /:entityType/:entityId/restricted-clinicians → clinicians blocked at a client
 */

import { Request, Response, NextFunction } from "express";
import RestrictedClinician from "../models/RestrictedClinician.js";
import Clinician           from "../models/Clinician.js";
import { logAudit }        from "../middleware/auditLogger.js";
import { normalizeId }     from "../lib/ids.js";

const safeJson = (v: any) => JSON.parse(JSON.stringify(v ?? null));
const toId = (v: any) => normalizeId(v);

/* ─── LIST ALL ───────────────────────────────────────────── */
export const listAllRestricted = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: any = { isActive: true };

    if (req.query.entityType) filter.entityType = req.query.entityType;
    if (req.query.entityId)   filter.entityId   = req.query.entityId;

    const records: any[] = await RestrictedClinician.find(filter)
      .populate("clinician", "fullName email clinicianType")
      .populate("addedBy",   "fullName email")
      .lean();

    records.sort((a, b) =>
      String(a.clinician?.fullName || "").localeCompare(String(b.clinician?.fullName || ""))
    );

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};

/* ─── GET RESTRICTED CLIENTS FOR A CLINICIAN ─────────────── */
export const getRestrictedClientsForClinician = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const records = await RestrictedClinician.find({ clinician: id, isActive: true })
      .populate("addedBy", "fullName email")
      .lean();

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};

/* ─── ADD PER-CLIENT RESTRICTION ─────────────────────────── */
export const addRestrictedClient = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid clinician id" });

    const clinician: any = await Clinician.findById(id).lean();
    if (!clinician) return res.status(404).json({ message: "Clinician not found" });

    const body = req.body || {};
    const entityType = String(body.entityType || "practice").toLowerCase();
    const entityId   = String(body.entityId   || "").trim();

    if (!entityId)
      return res.status(400).json({ message: "entityId is required" });

    if (!["practice", "pcn", "surgery"].includes(entityType))
      return res.status(400).json({ message: "entityType must be practice | pcn | surgery" });

    // Check for existing active restriction
    const existing = await RestrictedClinician.findOne({
      clinician: id,
      entityType,
      entityId,
      isActive: true,
    }).lean();

    if (existing)
      return res.status(409).json({ message: "Restriction already exists for this clinician + client" });

    const record = await RestrictedClinician.create({
      clinician:  id,
      entityType,
      entityId,
      reason:     String(body.reason || "").trim(),
      notes:      String(body.notes  || "").trim(),
      addedBy:    (req as any).user?._id || null,
      addedAt:    new Date().toISOString(),
      isActive:   true,
    });

    await logAudit(req, "ADD_RESTRICTED_CLIENT", "RestrictedClinician", {
      resourceId: (record as any)._id,
      detail: `Restricted clinician "${clinician.fullName || id}" from ${entityType} ${entityId}`,
      after:  safeJson(record),
    });

    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
};

/* ─── SOFT-REMOVE RESTRICTION ────────────────────────────── */
export const removeRestrictedClient = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id       = toId(req.params.id);
    const recordId = toId(req.params.recordId);
    if (!id || !recordId) return res.status(400).json({ message: "Invalid id" });

    const before: any = await RestrictedClinician.findById(recordId).lean();
    if (!before) return res.status(404).json({ message: "Restriction record not found" });
    if (String(before.clinician) !== String(id))
      return res.status(403).json({ message: "Record does not belong to this clinician" });

    const removeReason = String(req.body?.removeReason || "").trim();

    const updated = await RestrictedClinician.findByIdAndUpdate(
      recordId,
      {
        isActive:     false,
        removedAt:    new Date().toISOString(),
        removedBy:    (req as any).user?._id || null,
        removeReason,
      },
      { new: true }
    );

    await logAudit(req, "REMOVE_RESTRICTED_CLIENT", "RestrictedClinician", {
      resourceId: recordId,
      detail: `Removed per-client restriction for clinician ${id} from ${before.entityType} ${before.entityId}`,
      before: safeJson(before),
      after:  safeJson(updated),
    });

    res.json({ ok: true, record: updated });
  } catch (err) {
    next(err);
  }
};

/* ─── GET RESTRICTED CLINICIANS AT A CLIENT ──────────────── */
export const getRestrictedAtClient = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityType, entityId } = req.params;

    if (!entityId)
      return res.status(400).json({ message: "entityId is required" });

    const records = await RestrictedClinician.find({
      entityType,
      entityId,
      isActive: true,
    })
      .populate("clinician", "fullName email clinicianType gphcNumber")
      .populate("addedBy",   "fullName email")
      .lean();

    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};
