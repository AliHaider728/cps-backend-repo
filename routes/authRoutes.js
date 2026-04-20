/**
 * authRoutes.js
 *
 * UPDATED (Apr 2026):
 *   +GET  /users/:id   — getUserById  (spec §4)
 *   getAllUsers now supports ?role= ?isActive= ?department= filters (spec §5)
 *     — no route change needed, handled in controller via query params
 */

import { Router } from "express";
import { verifyToken }  from "../middleware/auth.js";
import { allowRoles }   from "../middleware/roleCheck.js";
import {
  login, loginLimiter,
  getMe, logout,
  getAllUsers,
  getUserById,       // ── NEW (spec §4)
  createUser, updateUser, deleteUser,
  anonymiseUser,
  changePassword,
} from "../controllers/authController.js";

const router = Router();

/* ── Public ───────────────────────────────────────────────────── */
router.post("/login", loginLimiter, login);

/* ── Authenticated (any role) ────────────────────────────────── */
router.get ("/me",              verifyToken, getMe);
router.post("/logout",          verifyToken, logout);
router.put ("/change-password", verifyToken, changePassword);

/* ── Super Admin only ────────────────────────────────────────── */
// ⚠️ /users/stats or any future static routes MUST come before /users/:id
router.get   ("/users",          verifyToken, allowRoles("super_admin"), getAllUsers);
router.post  ("/users",          verifyToken, allowRoles("super_admin"), createUser);

// NEW (spec §4): GET single user by id
// ⚠️ Must be AFTER /users (GET list) but BEFORE any /users/:id sub-routes
router.get   ("/users/:id",      verifyToken, allowRoles("super_admin"), getUserById);

router.put   ("/users/:id",      verifyToken, allowRoles("super_admin"), updateUser);
router.delete("/users/:id",      verifyToken, allowRoles("super_admin"), deleteUser);
router.post  ("/users/:id/gdpr", verifyToken, allowRoles("super_admin"), anonymiseUser);

export default router;