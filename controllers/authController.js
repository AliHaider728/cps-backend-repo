/**
 * authController.js
 *
 * UPDATED (Apr 2026) — Spec: CPS_Controller_Update_Spec.docx
 *
 * createUser    — +phone, +department, +jobTitle, +opsLead, +supervisor,
 *                  +startDate, +emergencyContact (spec §1)
 * updateUser    — +phone, +department, +jobTitle, +opsLead, +supervisor,
 *                  +startDate, +leaveDate, +emergencyContact (spec §2)
 * anonymiseUser — +phone, +emergencyContact wipe, +profilePhoto wipe,
 *                  +leaveDate set if missing (spec §3)
 * getUserById   — NEW: GET /api/auth/users/:id (spec §4)
 * getAllUsers /
 * getUsersByRole — +?role= +?isActive= +?department= filters,
 *                   comma-separated roles supported (spec §5)
 */

import jwt     from "jsonwebtoken";
import bcrypt  from "bcryptjs";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import { query }           from "../config/db.js";
import { getRequestIp, logAudit } from "../middleware/auditLogger.js";
import { sendWelcomeEmail }        from "../utils/sendEmail.js";

const USER_MODEL      = "user";
const AUDIT_MODEL     = "audit_log";
const PASSWORD_ROUNDS = 12;

const ROLE_REDIRECTS = {
  super_admin:  "/dashboard/super-admin",
  director:     "/dashboard/director",
  ops_manager:  "/dashboard/ops-manager",
  finance:      "/dashboard/finance",
  training:     "/dashboard/training",
  workforce:    "/dashboard/workforce",
  clinician:    "/portal/clinician",
};

/* ── Data helpers ──────────────────────────────────────────────────── */
function mapUserRow(row) {
  if (!row) return null;
  return {
    _id:       row.id,
    id:        row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at || null,
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function buildAuthUser(user) {
  return {
    id:                 user._id,
    name:               user.name,
    email:              user.email,
    role:               user.role,
    mustChangePassword: user.mustChangePassword ?? false,
    redirectTo:         ROLE_REDIRECTS[user.role] || "/",
  };
}

/* ── DB helpers ────────────────────────────────────────────────────── */
async function findUserById(id) {
  const result = await query(
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE model = $1 AND id = $2
     LIMIT 1`,
    [USER_MODEL, id]
  );
  return mapUserRow(result.rows[0]);
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const result = await query(
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE model = $1
     AND LOWER(COALESCE(data->>'email', '')) = $2
     LIMIT 1`,
    [USER_MODEL, normalizedEmail]
  );
  return mapUserRow(result.rows[0]);
}

async function insertUser(userData) {
  const id        = uuidv4();
  const timestamp = new Date().toISOString();
  const payload   = {
    ...userData,
    createdAt: userData.createdAt || timestamp,
    updatedAt: userData.updatedAt || timestamp,
  };
  const result = await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id, data, created_at, updated_at`,
    [USER_MODEL, id, JSON.stringify(payload)]
  );
  return mapUserRow(result.rows[0]);
}

async function updateUserRecord(id, patch) {
  const payload = { ...patch, updatedAt: new Date().toISOString() };
  const result  = await query(
    `UPDATE app_records
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2
     RETURNING id, data, created_at, updated_at`,
    [USER_MODEL, id, JSON.stringify(payload)]
  );
  return mapUserRow(result.rows[0]);
}

async function deleteUserRecord(id) {
  const result = await query(
    `DELETE FROM app_records
     WHERE model = $1 AND id = $2
     RETURNING id, data, created_at, updated_at`,
    [USER_MODEL, id]
  );
  return mapUserRow(result.rows[0]);
}

async function insertAuditRecord(req, data) {
  await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
    [
      AUDIT_MODEL,
      uuidv4(),
      JSON.stringify({
        ...data,
        ip:        data.ip        || getRequestIp(req),
        userAgent: data.userAgent || req.headers["user-agent"] || "",
      }),
    ]
  );
}

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

/* ── Rate limiter ─────────────────────────────────────────────────── */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  keyGenerator:          ipKeyGenerator,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders:   false,
  handler: (req, res) => {
    res.status(429).json({ message: "Too many failed login attempts. Please try again in 15 minutes." });
  },
});

/* ── Auth ─────────────────────────────────────────────────────────── */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required" });

    const normalizedEmail  = String(email).trim().toLowerCase();
    const user             = await findUserByEmail(normalizedEmail);
    const passwordMatches  = user
      ? await bcrypt.compare(String(password), user.password || "")
      : false;

    if (!user || !passwordMatches) {
      await insertAuditRecord(req, {
        action: "LOGIN_FAILED", resource: "User",
        detail: `Failed login attempt for: ${normalizedEmail}`, status: "fail",
      });
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.isActive === false) {
      req.user = user;
      await logAudit(req, "LOGIN_BLOCKED", "User", {
        resourceId: user._id, detail: "Login attempt on deactivated account", status: "fail",
      });
      return res.status(403).json({ message: "Account is deactivated. Contact admin." });
    }

    const updatedUser = await updateUserRecord(user._id, { lastLogin: new Date().toISOString() });
    req.user = updatedUser || user;
    await logAudit(req, "LOGIN", "User", {
      resourceId: user._id, detail: `${user.name} logged in (${user.role})`,
    });
    return res.json({ success: true, token: signToken(user._id), user: buildAuthUser(req.user) });
  } catch (error) {
    console.error("[login ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const getMe = async (req, res) => {
  return res.json({ success: true, user: buildAuthUser(req.user) });
};

export const logout = async (req, res) => {
  await logAudit(req, "LOGOUT", "User", {
    resourceId: req.user._id, detail: `${req.user.name} logged out`,
  });
  return res.json({ success: true, message: "Logged out successfully" });
};

/* ─────────────────────────────────────────────────────────────────────
   getAllUsers / getUsersByRole
   UPDATED (spec §5): supports ?role= ?isActive= ?department= filters
     comma-separated roles: ?role=clinician,ops_manager
───────────────────────────────────────────────────────────────────── */
export const getAllUsers = async (req, res) => {
  try {
    const { role, isActive, department } = req.query;

    // Build WHERE clauses dynamically
    const conditions = [
      `model = $1`,
      `COALESCE((data->>'isAnonymised')::boolean, false) = false`,
    ];
    const params = [USER_MODEL];
    let   idx    = 2;

    // ── role filter (spec §5): supports comma-separated ───────────────
    if (role) {
      const roles = String(role).split(",").map(r => r.trim()).filter(Boolean);
      if (roles.length === 1) {
        conditions.push(`data->>'role' = $${idx++}`);
        params.push(roles[0]);
      } else if (roles.length > 1) {
        const placeholders = roles.map(() => `$${idx++}`).join(", ");
        conditions.push(`data->>'role' IN (${placeholders})`);
        params.push(...roles);
      }
    }

    // ── isActive filter (spec §5) ─────────────────────────────────────
    if (isActive !== undefined) {
      const activeVal = isActive === "true" || isActive === true;
      conditions.push(`COALESCE((data->>'isActive')::boolean, true) = ${idx++}`);
      params.push(activeVal);
    }

    // ── department filter (spec §5) ───────────────────────────────────
    if (department) {
      conditions.push(`LOWER(COALESCE(data->>'department', '')) = LOWER($${idx++})`);
      params.push(department.trim());
    }

    const result = await query(
      `SELECT id, data, created_at, updated_at
       FROM app_records
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC`,
      params
    );

    const users = result.rows.map((row) => sanitizeUser(mapUserRow(row)));
    return res.json({ success: true, users });
  } catch (error) {
    console.error("[getAllUsers ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   getUserById  (NEW — spec §4)
   GET /api/auth/users/:id
   Returns single user with all profile fields, password stripped
───────────────────────────────────────────────────────────────────── */
export const getUserById = async (req, res) => {
  try {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    console.error("[getUserById ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   createUser
   UPDATED (spec §1): +phone, +department, +jobTitle, +opsLead,
     +supervisor, +startDate, +emergencyContact
───────────────────────────────────────────────────────────────────── */
export const createUser = async (req, res) => {
  try {
    const {
      name, email, password, role,
      // ── NEW FIELDS (spec §1) ────────────────────
      phone, department, jobTitle,
      opsLead, supervisor,
      startDate, emergencyContact,
    } = req.body;

    if (!name || !email || !password || !role)
      return res.status(400).json({ message: "All fields required" });

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser    = await findUserByEmail(normalizedEmail);
    if (existingUser)
      return res.status(400).json({ message: "Email already registered" });

    const hashedPassword = await bcrypt.hash(String(password), PASSWORD_ROUNDS);

    const user = await insertUser({
      name:             String(name).trim(),
      email:            normalizedEmail,
      password:         hashedPassword,
      role,
      isActive:         true,
      mustChangePassword: true,
      isAnonymised:     false,
      createdBy:        req.user?._id || null,
      lastLogin:        null,
      // ── NEW FIELDS ───────────────────────────────
      phone:            phone?.trim()     || "",
      department:       department?.trim() || "",
      jobTitle:         jobTitle?.trim()   || "",
      opsLead:          opsLead            || null,
      supervisor:       supervisor         || null,
      startDate:        startDate ? new Date(startDate).toISOString() : null,
      emergencyContact: emergencyContact   || { name: "", relationship: "", phone: "", email: "" },
    });

    try {
      await sendWelcomeEmail({ name: user.name, email: user.email, password, role: user.role });
    } catch (emailError) {
      console.error("[createUser EMAIL ERROR]", emailError.message);
    }

    await logAudit(req, "CREATE_USER", "User", {
      resourceId: user._id,
      detail: `Created user ${user.name} with role ${user.role}`,
      after: { name: user.name, email: user.email, role: user.role, isActive: user.isActive },
    });

    return res.status(201).json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    console.error("[createUser ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   updateUser
   UPDATED (spec §2): +phone, +department, +jobTitle, +opsLead,
     +supervisor, +startDate, +leaveDate, +emergencyContact
     Validates opsLead/supervisor are valid user IDs if provided.
───────────────────────────────────────────────────────────────────── */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, role, isActive, password,
      // ── NEW FIELDS (spec §2) ────────────────────
      phone, department, jobTitle,
      opsLead, supervisor,
      startDate, leaveDate,
      emergencyContact,
    } = req.body;

    const existingUser = await findUserById(id);
    if (!existingUser) return res.status(404).json({ message: "User not found" });

    const patch = {};

    if (typeof name === "string" && name.trim())  patch.name = name.trim();

    if (typeof email === "string" && email.trim()) {
      const normalizedEmail = email.trim().toLowerCase();
      const duplicate       = await findUserByEmail(normalizedEmail);
      if (duplicate && duplicate._id !== id)
        return res.status(400).json({ message: "Email already registered" });
      patch.email = normalizedEmail;
    }

    if (typeof role     === "string" && role.trim())  patch.role     = role;
    if (typeof isActive === "boolean")                patch.isActive = isActive;

    if (password) {
      patch.password          = await bcrypt.hash(String(password), PASSWORD_ROUNDS);
      patch.mustChangePassword = true;
    }

    // ── NEW FIELDS (spec §2) ──────────────────────────────────────────
    if (typeof phone      === "string") patch.phone      = phone.trim();
    if (typeof department === "string") patch.department = department.trim();
    if (typeof jobTitle   === "string") patch.jobTitle   = jobTitle.trim();

    // Validate opsLead/supervisor are valid user IDs if provided (spec §2)
    if (opsLead !== undefined) {
      if (opsLead) {
        const opLeadUser = await findUserById(opsLead);
        if (!opLeadUser)
          return res.status(400).json({ message: "opsLead user not found" });
      }
      patch.opsLead = opsLead || null;
    }

    if (supervisor !== undefined) {
      if (supervisor) {
        const supervisorUser = await findUserById(supervisor);
        if (!supervisorUser)
          return res.status(400).json({ message: "supervisor user not found" });
      }
      patch.supervisor = supervisor || null;
    }

    if (startDate !== undefined)
      patch.startDate = startDate ? new Date(startDate).toISOString() : null;

    if (leaveDate !== undefined)
      patch.leaveDate = leaveDate ? new Date(leaveDate).toISOString() : null;

    if (emergencyContact !== undefined)
      patch.emergencyContact = emergencyContact || { name: "", relationship: "", phone: "", email: "" };

    const updatedUser = await updateUserRecord(id, patch);
    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    await logAudit(req, "UPDATE_USER", "User", {
      resourceId: updatedUser._id,
      detail: `Updated user ${updatedUser.name}`,
      before: { name: existingUser.name, email: existingUser.email, role: existingUser.role, isActive: existingUser.isActive },
      after:  { name: updatedUser.name,  email: updatedUser.email,  role: updatedUser.role,  isActive: updatedUser.isActive  },
    });

    return res.json({ success: true, user: sanitizeUser(updatedUser) });
  } catch (error) {
    console.error("[updateUser ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const deletedUser = await deleteUserRecord(req.params.id);
    if (!deletedUser) return res.status(404).json({ message: "User not found" });

    await logAudit(req, "DELETE_USER", "User", {
      resourceId: deletedUser._id,
      detail: `Deleted user ${deletedUser.name} (${deletedUser.email})`,
      before: { name: deletedUser.name, email: deletedUser.email, role: deletedUser.role },
    });

    return res.json({ success: true, message: "User deleted" });
  } catch (error) {
    console.error("[deleteUser ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

/* ─────────────────────────────────────────────────────────────────────
   anonymiseUser
   UPDATED (spec §3): also wipes phone, emergencyContact, profilePhoto
     sets leaveDate if not already set
───────────────────────────────────────────────────────────────────── */
export const anonymiseUser = async (req, res) => {
  try {
    const existingUser = await findUserById(req.params.id);
    if (!existingUser) return res.status(404).json({ message: "User not found" });

    const updatedUser = await updateUserRecord(existingUser._id, {
      name:         "Anonymised User",
      email:        `anonymised-${existingUser._id}@example.local`,
      password:     "",
      isAnonymised: true,
      isActive:     false,
      // ── NEW FIELDS (spec §3) ─────────────────────
      phone:        "",
      profilePhoto: "",
      emergencyContact: { name: "", relationship: "", phone: "", email: "" },
      // Set leaveDate only if not already recorded (spec §3)
      leaveDate: existingUser.leaveDate || new Date().toISOString(),
    });

    await logAudit(req, "GDPR_ANONYMISE", "User", {
      resourceId: existingUser._id,
      detail: "User anonymised for GDPR compliance",
      before: { name: existingUser.name, email: existingUser.email, role: existingUser.role },
      after:  { name: updatedUser?.name, email: updatedUser?.email, role: updatedUser?.role, isActive: updatedUser?.isActive },
    });

    return res.json({ success: true, message: "User anonymised successfully" });
  } catch (error) {
    console.error("[anonymiseUser ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });

    const updatedUser = await updateUserRecord(req.user._id, {
      password:          await bcrypt.hash(String(newPassword), PASSWORD_ROUNDS),
      mustChangePassword: false,
    });
    if (!updatedUser) return res.status(404).json({ message: "User not found" });

    req.user = updatedUser;
    await logAudit(req, "CHANGE_PASSWORD", "User", {
      resourceId: req.user._id, detail: `${req.user.name} changed their password`,
    });

    return res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("[changePassword ERROR]", error.message);
    return res.status(500).json({ message: error.message });
  }
};
