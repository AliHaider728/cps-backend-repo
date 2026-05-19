import express from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import checkRestricted from "../middleware/checkRestricted.js";
import {
  assignCoverRequest,
  createCoverRequest,
  getOpenCoverRequests,
  updateCoverStatus,
} from "../controllers/coverController.js";

const router = express.Router();
const MANAGERS = ["super_admin", "ops_manager", "workforce", "director"];

router.use(authenticate);

router.get("/open", allowRoles(...MANAGERS), getOpenCoverRequests);
router.post("/create", allowRoles(...MANAGERS), createCoverRequest);
router.post("/:id/assign", allowRoles(...MANAGERS), checkRestricted, assignCoverRequest);
router.put("/:id/status", allowRoles(...MANAGERS), updateCoverStatus);

export default router;
