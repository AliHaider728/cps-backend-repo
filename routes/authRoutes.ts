/**
 * authRoutes.ts
 *
 * UPDATED (Apr 2026):
 *   +GET  /users/:id        — getUserById  (spec §4)
 *   +PUT  /users/:id/password — admin password change for any user (NEW FIX)
 *   getAllUsers now supports ?role= ?isActive= ?department= filters (spec §5)
 *
 * Routes reordered (Jun 2026): ALL GET -> ALL POST -> ALL PUT -> ALL DELETE
 * Each method has its own independent @swagger block so Swagger UI groups
 * strictly by method order, not mixed per path.
 */

import { Router, Request, Response, NextFunction } from "express";
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
  adminChangeUserPassword,
} from "../controllers/authController.js";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Auth - GET
 *     description: Read / fetch endpoints
 *   - name: Auth - POST
 *     description: Create / action endpoints
 *   - name: Auth - PUT
 *     description: Update endpoints
 *   - name: Auth - DELETE
 *     description: Delete endpoints
 */

/* ===========================================================
 *  GET ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current logged-in user info
 *     tags: [Auth - GET]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 *       401:
 *         description: Unauthorized
 */
router.get("/me", verifyToken, getMe);

/**
 * @swagger
 * /api/auth/users:
 *   get:
 *     summary: Get all users (Super Admin only)
 *     tags: [Auth - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Filter by user role
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by department
 *     responses:
 *       200:
 *         description: List of users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 */
router.get   ("/users",               verifyToken, allowRoles("super_admin"), getAllUsers);

/**
 * @swagger
 * /api/auth/users/{id}:
 *   get:
 *     summary: Get a single user by ID (Super Admin only)
 *     tags: [Auth - GET]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: User not found
 */
router.get   ("/users/:id",           verifyToken, allowRoles("super_admin"), getUserById);


/* ===========================================================
 *  POST ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth - POST]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful, returns token and user info
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */
router.post("/login", loginLimiter, login);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout current user
 *     tags: [Auth - POST]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post("/logout", verifyToken, logout);

/**
 * @swagger
 * /api/auth/users:
 *   post:
 *     summary: Create a new user (Super Admin only)
 *     tags: [Auth - POST]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *               - role
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *               department:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 */
router.post  ("/users",               verifyToken, allowRoles("super_admin"), createUser);

/**
 * @swagger
 * /api/auth/users/{id}/gdpr:
 *   post:
 *     summary: Anonymise a user's data (GDPR) (Super Admin only)
 *     tags: [Auth - POST]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User data anonymised successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: User not found
 */
router.post  ("/users/:id/gdpr",      verifyToken, allowRoles("super_admin"), anonymiseUser);


/* ===========================================================
 *  PUT ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Change own password
 *     tags: [Auth - PUT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized / wrong old password
 */
router.put("/change-password", verifyToken, changePassword);

/**
 * @swagger
 * /api/auth/users/{id}:
 *   put:
 *     summary: Update a user by ID (Super Admin only)
 *     tags: [Auth - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *               department:
 *                 type: string
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: User not found
 */
router.put   ("/users/:id",           verifyToken, allowRoles("super_admin"), updateUser);

/**
 * @swagger
 * /api/auth/users/{id}/password:
 *   put:
 *     summary: Admin changes password for any user (Super Admin only)
 *     tags: [Auth - PUT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: User not found
 */
router.put   ("/users/:id/password",  verifyToken, allowRoles("super_admin"), adminChangeUserPassword);


/* ===========================================================
 *  DELETE ROUTES
 * =========================================================== */

/**
 * @swagger
 * /api/auth/users/{id}:
 *   delete:
 *     summary: Delete a user by ID (Super Admin only)
 *     tags: [Auth - DELETE]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super_admin)
 *       404:
 *         description: User not found
 */
router.delete("/users/:id",           verifyToken, allowRoles("super_admin"), deleteUser);

export default router;
