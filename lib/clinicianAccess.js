import { resolveClinicianIdForUser } from "./clinicianLink.js";
import { normalizeId } from "./ids.js";

/** Clinician may only access their own profile id unless admin/manager. */
export async function assertClinicianAccess(req, clinicianId) {
  const id = normalizeId(clinicianId);
  if (!id) {
    const err = new Error("Invalid clinician id");
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
  if (managers.includes(role)) return id;

  if (role === "clinician") {
    const ownId = await resolveClinicianIdForUser(req.user);
    if (ownId && String(ownId) === String(id)) return id;
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }

  const err = new Error("Forbidden");
  err.statusCode = 403;
  throw err;
}
