const jwt  = require("jsonwebtoken");
const User = require("../models/User");

const ROLE_REDIRECTS = {
  super_admin: "/dashboard/super-admin",
  director:    "/dashboard/director",
  ops_manager: "/dashboard/ops-manager",
  finance:     "/dashboard/finance",
  training:    "/dashboard/training",
  workforce:   "/dashboard/workforce",
  clinician:   "/portal/clinician",
};

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });
    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: "Invalid email or password" });
    if (!user.isActive)
      return res.status(403).json({ message: "Account is deactivated. Contact admin." });
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    const token = signToken(user._id);
    res.json({
      success: true,
      token,
      user: {
        id:         user._id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        redirectTo: ROLE_REDIRECTS[user.role],
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  res.json({
    success: true,
    user: {
      id:         req.user._id,
      name:       req.user.name,
      email:      req.user.email,
      role:       req.user.role,
      redirectTo: ROLE_REDIRECTS[req.user.role],
    },
  });
};

const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ message: "All fields required" });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "Email already registered" });
    const user = await User.create({ name, email, password, role, createdBy: req.user._id });
    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { name, email, role, isActive, password } = req.body;
    const user = await User.findById(req.params.id).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (name)     user.name     = name;
    if (email)    user.email    = email;
    if (role)     user.role     = role;
    if (typeof isActive === "boolean") user.isActive = isActive;
    if (password) user.password = password;
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { login, getMe, getAllUsers, createUser, updateUser, deleteUser };
