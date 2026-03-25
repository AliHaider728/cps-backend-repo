import { Router } from "express";
import { verifyToken }  from "../middleware/auth.js";
import { allowRoles }   from "../middleware/roleCheck.js";
import {
  login, loginLimiter,
  getMe, logout,
  getAllUsers, createUser, updateUser, deleteUser,
  anonymiseUser,
} from "../controllers/authController.js";

const router = Router();

// Public
router.post("/login", loginLimiter, login);   // ← rate limited: 10 / 15 min per IP

// Authenticated
router.get ("/me",     verifyToken, getMe);
router.post("/logout", verifyToken, logout);

// Super Admin only
router.get   ("/users",           verifyToken, allowRoles("super_admin"), getAllUsers);
router.post  ("/users",           verifyToken, allowRoles("super_admin"), createUser);
router.put   ("/users/:id",       verifyToken, allowRoles("super_admin"), updateUser);
router.delete("/users/:id",       verifyToken, allowRoles("super_admin"), deleteUser);
router.post  ("/users/:id/gdpr",  verifyToken, allowRoles("super_admin"), anonymiseUser);

export default router;