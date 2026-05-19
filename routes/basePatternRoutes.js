import express from "express";
import { authenticate } from "../middleware/auth.js";
import { allowRoles } from "../middleware/roleCheck.js";
import {
  createBasePattern,
  deactivateBasePattern,
  getClinicianBasePatterns,
  updateBasePattern,
} from "../controllers/basePatternController.js";

const router = express.Router();
const MANAGERS = ["super_admin", "ops_manager", "finance", "director"];

router.use(authenticate);

router.post("/", allowRoles(...MANAGERS), createBasePattern);
router.get("/:clinician_id", allowRoles(...MANAGERS, "clinician"), getClinicianBasePatterns);
router.put("/:id", allowRoles(...MANAGERS), updateBasePattern);
router.delete("/:id", allowRoles(...MANAGERS), deactivateBasePattern);

export default router;
