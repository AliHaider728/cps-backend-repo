import Clinician from "../models/Clinician.js";

export const allowRoles = (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    next();
  };

export const allowClinicianSelfOrRoles = (paramName, ...roles) =>
  async (req, res, next) => {
    try {
      if (roles.includes(req.user?.role)) return next();

      if (req.user?.role !== "clinician") {
        return res.status(403).json({ message: "Access denied: insufficient permissions" });
      }

      const clinicianId = req.params?.[paramName];
      if (!clinicianId) {
        return res.status(400).json({ message: `${paramName} is required` });
      }

      const clinician = await Clinician.findById(clinicianId).lean();
      if (!clinician) return res.status(404).json({ message: "Clinician not found" });

      if (String(clinician.user || "") !== String(req.user?._id || req.user?.id || "")) {
        return res.status(403).json({ message: "Access denied: cannot access another clinician rota" });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };

export const blockClinicianOnRota = (req, res, next) => {
  if (req.user?.role === "clinician") {
    return res.status(403).json({ message: "Clinician role is blocked from /api/rota. Use clinician rota endpoint." });
  }
  next();
};