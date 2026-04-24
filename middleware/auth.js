import jwt from "jsonwebtoken";
import { findAppRecordById } from "../config/db.js";

const USER_MODEL = "user";

async function findUserById(id) {
  return findAppRecordById(USER_MODEL, id);
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

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        code: "TOKEN_EXPIRED",
        message: "Session expired. Please refresh your token.",
        expiredAt: error.expiredAt,
        requiresRefresh: true, // Signal to frontend that refresh is needed
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
    return next(); // Continue without user
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(decoded.id);
    if (user && user.isActive !== false) {
      req.user = user;
    }
  } catch (error) {
    // Ignore errors for optional auth
    console.warn("[optionalAuth] Token validation failed:", error.message);
  }

  return next();
};