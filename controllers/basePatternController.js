import { asyncHandler } from "../lib/asyncHandler.js";
import BasePattern from "../models/BasePattern.js";

const ok = (res, data, message = "OK", status = 200) => res.status(status).json({ success: true, data, message });

export const createBasePattern = asyncHandler(async (req, res) => {
  const days = Array.isArray(req.body.day_of_week) ? req.body.day_of_week : [req.body.day_of_week];
  const created = [];
  for (const day of days) {
    created.push(await BasePattern.create({ ...req.body, day_of_week: Number(day), created_by: req.user?._id || req.user?.id }));
  }
  return ok(res, created, "Base pattern created", 201);
});

export const getClinicianBasePatterns = asyncHandler(async (req, res) => {
  const patterns = await BasePattern.findByClinician(req.params.clinician_id);
  return ok(res, patterns);
});

export const updateBasePattern = asyncHandler(async (req, res) => {
  const pattern = await BasePattern.update(req.params.id, req.body || {});
  return ok(res, pattern, "Base pattern updated");
});

export const deactivateBasePattern = asyncHandler(async (req, res) => {
  const pattern = await BasePattern.deactivate(req.params.id);
  return ok(res, pattern, "Base pattern deactivated");
});
