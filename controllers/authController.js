import jwt from "jsonwebtoken";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { logAudit } from "../middleware/auditLogger.js";

// ── Per-IP login rate limiter: 10 attempts / 15 min ─────────────
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req), //   FIXED (IPv6 safe)
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many failed login attempts. Please try again in 15 minutes.",
  },
});

// ── ROLE REDIRECTS ─────────
const ROLE_REDIRECTS = {
  super_admin: "/dashboard/super-admin",
  director: "/dashboard/director",
  ops_manager: "/dashboard/ops-manager",
  finance: "/dashboard/finance",
  training: "/dashboard/training",
  workforce: "/dashboard/workforce",
  clinician: "/portal/clinician",
};

// ── SIGN TOKEN ─────────
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

// ── LOGIN ─────────
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email }).select("+password");

    //   Invalid credentials
    if (!user || !(await user.matchPassword(password))) {
      await AuditLog.create({
        action: "LOGIN_FAILED",
        resource: "User",
        detail: `Failed login attempt for email: ${email}`,
        ip: req.ip ?? req.headers["x-forwarded-for"] ?? "unknown",
        userAgent: req.headers["user-agent"] ?? "",
        status: "fail",
      });

      return res.status(401).json({ message: "Invalid email or password" });
    }

    //   Deactivated account
    if (!user.isActive) {
      await logAudit(req, "LOGIN_BLOCKED", "User", {
        resourceId: user._id,
        detail: "Login attempt on deactivated account",
        status: "fail",
      });

      return res.status(403).json({
        message: "Account is deactivated. Contact admin.",
      });
    }

    //   Success login
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);

    // Audit success
    req.user = user;
    await logAudit(req, "LOGIN", "User", {
      resourceId: user._id,
      detail: `${user.name} logged in (${user.role})`,
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        redirectTo: ROLE_REDIRECTS[user.role],
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── GET ME ─────────
export const getMe = (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      redirectTo: ROLE_REDIRECTS[req.user.role],
    },
  });
};

// ── LOGOUT ─────────
export const logout = async (req, res) => {
  await logAudit(req, "LOGOUT", "User", {
    resourceId: req.user._id,
    detail: `${req.user.name} logged out`,
  });

  res.json({ success: true, message: "Logged out successfully" });
};

// ── GET ALL USERS ─────────
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({
      isAnonymised: { $ne: true },
    }).sort({ createdAt: -1 });

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── CREATE USER ─────────
export const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      createdBy: req.user._id,
    });

    await logAudit(req, "CREATE_USER", "User", {
      resourceId: user._id,
      detail: `Created user ${user.name} with role ${user.role}`,
      after: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    return res.status(201).json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── UPDATE USER ─────────
export const updateUser = async (req, res) => {
  try {
    const { name, email, role, isActive, password } = req.body;

    const user = await User.findById(req.params.id).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const before = {
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };

    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;
    if (password) user.password = password;

    await user.save();

    await logAudit(req, "UPDATE_USER", "User", {
      resourceId: user._id,
      detail: `Updated user ${user.name}`,
      before,
      after: {
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── DELETE USER ─────────
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await logAudit(req, "DELETE_USER", "User", {
      resourceId: req.params.id,
      detail: `Deleted user ${user.name} (${user.email})`,
      before: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    return res.json({ success: true, message: "User deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── GDPR ANONYMISE ─────────
export const anonymiseUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await user.anonymise();

    await logAudit(req, "GDPR_ANONYMISE", "User", {
      resourceId: req.params.id,
      detail: "User anonymised for GDPR compliance",
    });

    return res.json({
      success: true,
      message: "User anonymised successfully",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};