import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import CoverRequest from "../models/CoverRequest.js";

const ok = (res: Response, data: any, message = "OK", status = 200) => res.status(status).json({ success: true, data, message });

export const getOpenCoverRequests = asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  const requests = await CoverRequest.getOpen();
  return ok(res, requests);
});

export const createCoverRequest = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const request = await CoverRequest.create({ ...req.body, created_by: (req as any).user?._id || (req as any).user?.id });
  return ok(res, request, "Cover request created", 201);
});

export const assignCoverRequest = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const assigned = await CoverRequest.assign(
    req.params.id,
    req.body.clinician_id || req.body.assigned_to,
    (req as any).user?._id || (req as any).user?.id
  );
  return ok(res, assigned, "Cover request assigned");
});

export const updateCoverStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const updated = await CoverRequest.updateStatus(req.params.id, req.body.status);
  return ok(res, updated, "Cover request status updated");
});
