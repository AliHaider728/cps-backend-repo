/**
 * routes/timeEntryRoutes.js — Rota Module (Clock-In / Clock-Out)
 *
 * Mounted at /api/time-entries by server.js.
 *
 * Clinicians:
 *   POST /clock-in            → start timer for a shift
 *   POST /clock-out           → stop timer, calculate actual hours
 *   GET  /active              → get own active clock-in entry
 *   GET  /                    → list own time entries
 *
 * Admins (super_admin, ops_manager, workforce):
 *   GET  /active?clinicianId= → get any clinician's active entry
 *   GET  /?clinicianId=       → list entries for any clinician
 *   GET  /admin/summary       → aggregated summary for all clinicians
 */

import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles  } from "../middleware/roleCheck.js";
import {
  clockIn,
  clockOut,
  getActive,
  listEntries,
  getAdminSummary,
} from "../controllers/timeEntryController.js";

const router = Router();

const adminRoles = ["super_admin", "director", "ops_manager", "finance", "training", "workforce"];

/* ── Clock-in / Clock-out
     allowRoles hata diya — role check controller mein
     resolveClinicianId() karta hai (403 deta hai agar clinician nahi)
  ─────────────────────────────────────────────────────────────────────────── */
router.post("/clock-in",  verifyToken, clockIn);
router.post("/clock-out", verifyToken, clockOut);

/* ── Mixed: clinician sees own, admin can pass ?clinicianId ────────────────── */
router.get("/active", verifyToken, allowRoles("clinician", ...adminRoles), getActive);
router.get("/",       verifyToken, allowRoles("clinician", ...adminRoles), listEntries);

/* ── Admin-only: aggregated summary ───────────────────────────────────────── */
router.get("/admin/summary", verifyToken, allowRoles(...adminRoles), getAdminSummary);

export default router;