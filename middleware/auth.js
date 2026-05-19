import jwt from "jsonwebtoken";
import { findAppRecordById, query } from "../config/db.js";

const USER_MODEL = "user";

async function findUserById(id) {
  return findAppRecordById(USER_MODEL, id);
}

/* ─── Attach clinicianId to user if role is clinician ─────────────────────── */
async function attachClinicianId(user) {
  if (user.role !== "clinician") return user;

  // Already has it (e.g. stored in user record)
  if (user.clinicianId) return user;

  const userId = String(user._id || user.id || "");
  if (!userId) return user;

  // Try MongoDB-style app_records (Clinician model)
  try {
    const result = await query(
      `SELECT id FROM app_records
       WHERE model = 'Clinician'
       AND (data->>'user' = $1 OR data->>'userId' = $1)
       LIMIT 1`,
      [userId]
    );
    if (result.rows[0]?.id) {
      user.clinicianId = result.rows[0].id;
      return user;
    }
  } catch (e) {
    console.error("[attachClinicianId PG error]", e.message);
  }

  return user;
}

export const verifyToken = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      code: "AUTH_TOKEN_MISSING",
      message: "Not authorised - no token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({
        code: "AUTH_USER_NOT_FOUND",
        message: "User not found",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        code: "AUTH_ACCOUNT_DEACTIVATED",
        message: "Account deactivated - contact admin",
      });
    }

    // ── Clinician ke liye clinicianId attach karo ──────────────
    req.user = await attachClinicianId(user);

    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        code: "TOKEN_EXPIRED",
        message: "Session expired. Please refresh your token.",
        expiredAt: error.expiredAt,
        requiresRefresh: true,
      });
    }

    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      return res.status(401).json({
        code: "TOKEN_INVALID",
        message: "Token invalid",
      });
    }

    return next(error);
  }
};

// Optional auth middleware - doesn't fail if no token
export const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(decoded.id);
    if (user && user.isActive !== false) {
      req.user = await attachClinicianId(user);
    }
  } catch (error) {
    console.warn("[optionalAuth] Token validation failed:", error.message);
  }

  return next();
};

// ── Alias exports — routes jo 'authenticate' import karte hain unke liye ──
export const authenticate = verifyToken;