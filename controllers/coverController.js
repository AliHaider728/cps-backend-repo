import { asyncHandler } from "../lib/asyncHandler.js";
import CoverRequest from "../models/CoverRequest.js";

const ok = (res, data, message = "OK", status = 200) => res.status(status).json({ success: true, data, message });

export const getOpenCoverRequests = asyncHandler(async (_req, res) => {
  const requests = await CoverRequest.getOpen();
  return ok(res, requests);
});

export const createCoverRequest = asyncHandler(async (req, res) => {
  const request = await CoverRequest.create({ ...req.body, created_by: req.user?._id || req.user?.id });
  return ok(res, request, "Cover request created", 201);
});

export const assignCoverRequest = asyncHandler(async (req, res) => {
  const assigned = await CoverRequest.assign(
    req.params.id,
    req.body.clinician_id || req.body.assigned_to,
    req.user?._id || req.user?.id
  );
  return ok(res, assigned, "Cover request assigned");
});

export const updateCoverStatus = asyncHandler(async (req, res) => {
  const updated = await CoverRequest.updateStatus(req.params.id, req.body.status);
  return ok(res, updated, "Cover request status updated");
});
