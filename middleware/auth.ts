import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { findAppRecordById } from "../config/db.js";
import { attachClinicianIdToUser } from "../lib/clinicianLink.js";

const USER_MODEL = "user";

async function findUserById(id: string | number) {
  return findAppRecordById(USER_MODEL, String(id));
}

export interface AuthRequest extends Request {
  user?: any;
}

export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload & { id: string };
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

    req.user = await attachClinicianIdToUser(user);
    return next();
  } catch (error: any) {
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

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token: string | undefined;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload & { id: string };
    const user    = await findUserById(decoded.id);
    if (user && user.isActive !== false) {
      req.user = await attachClinicianIdToUser(user);
    }
  } catch (error: any) {
    console.warn("[optionalAuth] Token validation failed:", error.message);
  }
  return next();
};

export const authenticate = verifyToken;
