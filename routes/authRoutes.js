/**
 * authRoutes.js
 *
 * UPDATED (Apr 2026):
 *   +GET  /users/:id        — getUserById  (spec §4)
 *   +PUT  /users/:id/password — admin password change for any user (NEW FIX)
 *   getAllUsers now supports ?role= ?isActive= ?department= filters (spec §5)
 */

import { Router } from "express";
import { verifyToken }  from "../middleware/auth.js";
import { allowRoles }   from "../middleware/roleCheck.js";
import {
  login, loginLimiter,
  getMe, logout,
  getAllUsers,
  getUserById,
  createUser, updateUser, deleteUser,
  anonymiseUser,
  changePassword,
  adminChangeUserPassword,   // ← NEW
} from "../controllers/authController.js";

const router = Router();

/* ── Public ───────────────────────────────────────────────────── */
router.post("/login", loginLimiter, login);

/* ── Authenticated (any role) ────────────────────────────────── */
router.get ("/me",              verifyToken, getMe);
router.post("/logout",          verifyToken, logout);
router.put ("/change-password", verifyToken, changePassword);

/* ── Super Admin only ────────────────────────────────────────── */
router.get   ("/users",               verifyToken, allowRoles("super_admin"), getAllUsers);
router.post  ("/users",               verifyToken, allowRoles("super_admin"), createUser);
router.get   ("/users/:id",           verifyToken, allowRoles("super_admin"), getUserById);
router.put   ("/users/:id",           verifyToken, allowRoles("super_admin"), updateUser);

// ✅ NEW: Admin changes password for any user (used from Clinicians list)
router.put   ("/users/:id/password",  verifyToken, allowRoles("super_admin"), adminChangeUserPassword);

router.delete("/users/:id",           verifyToken, allowRoles("super_admin"), deleteUser);
router.post  ("/users/:id/gdpr",      verifyToken, allowRoles("super_admin"), anonymiseUser);

export default router;