import express from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  getMyEnterHours,
  upsertMyEnterHours,
  submitMyEnterHours,
  listManagerEnterHours,
  reviewManagerEnterHours,
} from "../controllers/enterMyHoursController.js";

const router = express.Router();

router.use(authenticate);

router.get("/my", allowRoles("clinician"), getMyEnterHours);
router.post("/my/upsert", allowRoles("clinician"), upsertMyEnterHours);
router.post("/my/submit", allowRoles("clinician"), submitMyEnterHours);

router.get(
  "/manager",
  allowRoles("super_admin", "ops_manager", "workforce", "director", "finance"),
  listManagerEnterHours
);
router.patch(
  "/manager/:id/review",
  allowRoles("super_admin", "ops_manager", "workforce", "director", "finance"),
  reviewManagerEnterHours
);

export default router;

