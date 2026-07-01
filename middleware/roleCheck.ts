import { Request, Response, NextFunction } from "express";
import Clinician from "../models/Clinician.js";

export interface RoleRequest extends Request {
  user?: {
    role?: string;
    id?: string;
    _id?: string;
    [key: string]: any;
  };
}

export const allowRoles = (...roles: string[]) =>
  (req: RoleRequest, res: Response, next: NextFunction) => {
    if (!roles.includes(req.user?.role as string))
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    next();
  };

export const allowClinicianSelfOrRoles = (paramName: string, ...roles: string[]) =>
  async (req: RoleRequest, res: Response, next: NextFunction) => {
    try {
      if (roles.includes(req.user?.role as string)) return next();

      if (req.user?.role !== "clinician") {
        return res.status(403).json({ message: "Access denied: insufficient permissions" });
      }

      const clinicianId = req.params?.[paramName];
      if (!clinicianId) {
        return res.status(400).json({ message: `${paramName} is required` });
      }

      const clinician = await Clinician.findById(clinicianId).lean() as any;
      if (!clinician) return res.status(404).json({ message: "Clinician not found" });

      if (String(clinician.user || "") !== String(req.user?._id || req.user?.id || "")) {
        return res.status(403).json({ message: "Access denied: cannot access another clinician rota" });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };

export const blockClinicianOnRota = (req: RoleRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === "clinician") {
    return res.status(403).json({ message: "Clinician role is blocked from /api/rota. Use clinician rota endpoint." });
  }
  next();
};
