import { Router } from "express";
import { verifyToken } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  listAdminLeaves,
  reviewLeave,
  getLeaveReport,
} from "../controllers/leaveAdminController.js";

const router = Router();

const adminReader = [
  verifyToken,
  allowRoles("super_admin", "director", "ops_manager", "finance"),
];
const adminWriter = [verifyToken, allowRoles("super_admin", "ops_manager", "director")];

router.get("/", ...adminReader, listAdminLeaves);
router.get("/report", ...adminReader, getLeaveReport);
router.patch("/:id/review", ...adminWriter, reviewLeave);

export default router;
