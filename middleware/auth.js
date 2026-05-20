import jwt from "jsonwebtoken";
import { findAppRecordById, query } from "../config/db.js";

const USER_MODEL = "user";

async function findUserById(id) {
  return findAppRecordById(USER_MODEL, id);
}

/**
 * attachClinicianId — links a clinician user to their clinicians table row.
 *
 * Priority order:
 * 1. Already on user object
 * 2. clinicians table (Supabase) — matches on user_id column
 * 3. clinicians table — matches on email column
 * 4. app_records fallback (legacy Mongo records)
 */
async function attachClinicianId(user) {
  if (user.role !== "clinician") return user;
  if (user.clinicianId) return user;

  const userId = String(user._id || user.id || "").trim();
  const email  = String(user.email || "").toLowerCase().trim();

  // ── 1. clinicians table: match by user_id ─────────────────────────────────
  if (userId) {
    try {
      const byUserId = await query(
        `SELECT id FROM clinicians WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (byUserId.rows[0]?.id) {
        user.clinicianId = String(byUserId.rows[0].id);
        return user;
      }
    } catch (e) {
      // clinicians table may not have user_id column — continue
    }
  }

  // ── 2. clinicians table: match by email ───────────────────────────────────
  if (email) {
    try {
      const byEmail = await query(
        `SELECT id FROM clinicians WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      if (byEmail.rows[0]?.id) {
        user.clinicianId = String(byEmail.rows[0].id);
        return user;
      }
    } catch (e) {
      // clinicians table may not have email column — continue
    }
  }

  // ── 3. app_records fallback (legacy) ──────────────────────────────────────
  if (userId) {
    try {
      const legacy = await query(
        `SELECT id FROM app_records
          WHERE model = 'Clinician'
            AND (data->>'user' = $1 OR data->>'userId' = $1)
          LIMIT 1`,
        [userId]
      );
      if (legacy.rows[0]?.id) {
        user.clinicianId = String(legacy.rows[0].id);
        return user;
      }
    } catch (e) {
      console.error("[attachClinicianId legacy error]", e.message);
    }
  }

  // ── 4. Last resort: use the user's own ID ─────────────────────────────────
  // Only if no clinician record found — rota query will return 0 rows
  // but at least won't crash. Log a warning.
  if (userId) {
    console.warn(
      `[attachClinicianId] No clinician record found for user ${userId} (${email}). ` +
      `Make sure this user has a matching row in the clinicians table.`
    );
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
      code:    "AUTH_TOKEN_MISSING",
      message: "Not authorised - no token provided",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({
        code:    "AUTH_USER_NOT_FOUND",
        message: "User not found",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        code:    "AUTH_ACCOUNT_DEACTIVATED",
        message: "Account deactivated - contact admin",
      });
    }

    req.user = await attachClinicianId(user);
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        code:            "TOKEN_EXPIRED",
        message:         "Session expired. Please refresh your token.",
        expiredAt:       error.expiredAt,
        requiresRefresh: true,
      });
    }
    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      return res.status(401).json({
        code:    "TOKEN_INVALID",
        message: "Token invalid",
      });
    }
    return next(error);
  }
};

export const optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await findUserById(decoded.id);
    if (user && user.isActive !== false) {
      req.user = await attachClinicianId(user);
    }
  } catch (error) {
    console.warn("[optionalAuth] Token validation failed:", error.message);
  }
  return next();
};

export const authenticate = verifyToken;