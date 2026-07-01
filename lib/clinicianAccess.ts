import { resolveClinicianIdForUser, ClinicianUser } from "./clinicianLink.js";
import { normalizeId } from "./ids.js";
import { Request } from "express";

export interface CustomError extends Error {
  statusCode?: number;
}

export interface RequestWithUser extends Request {
  user?: ClinicianUser;
}

/** Clinician may only access their own profile id unless admin/manager. */
export async function assertClinicianAccess(req: RequestWithUser, clinicianId: string | null | undefined): Promise<string> {
  const id = normalizeId(clinicianId);
  if (!id) {
    const err = new Error("Invalid clinician id") as CustomError;
    err.statusCode = 400;
    throw err;
  }

  const role = req.user?.role;
  const managers = [
    "super_admin",
    "director",
    "ops_manager",
    "finance",
    "training_manager",
    "workforce_manager",
  ];
  if (role && managers.includes(role)) return id;

  if (role === "clinician") {
    const ownId = await resolveClinicianIdForUser(req.user);
    if (ownId && String(ownId) === String(id)) return id;
    const err = new Error("Forbidden") as CustomError;
    err.statusCode = 403;
    throw err;
  }

  const err = new Error("Forbidden") as CustomError;
  err.statusCode = 403;
  throw err;
}
