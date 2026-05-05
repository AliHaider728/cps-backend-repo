export const allowRoles = (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ message: "Access denied: insufficient permissions" });
    next();
  };

export const blockClinicianOnRota = (req, res, next) => {
  if (req.user?.role === "clinician") {
    return res.status(403).json({ message: "Clinician role is blocked from /api/rota. Use clinician rota endpoint." });
  }
  next();
};