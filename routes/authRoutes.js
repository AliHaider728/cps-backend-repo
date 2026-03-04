const express   = require("express");
const router    = express.Router();
const { verifyToken } = require("../middleware/auth");
const { allowRoles }  = require("../middleware/roleCheck");
const {
  login, getMe,
  getAllUsers, createUser, updateUser, deleteUser,
} = require("../controllers/authController");

router.post("/login", login);
router.get ("/me",          verifyToken, getMe);
router.get ("/users",       verifyToken, allowRoles("super_admin"), getAllUsers);
router.post("/users",       verifyToken, allowRoles("super_admin"), createUser);
router.put ("/users/:id",   verifyToken, allowRoles("super_admin"), updateUser);
router.delete("/users/:id", verifyToken, allowRoles("super_admin"), deleteUser);

module.exports = router;
