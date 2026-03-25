import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const verifyToken = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token)
    return res.status(401).json({ message: "Not authorised — no token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user)
      return res.status(401).json({ message: "User not found" });
    if (!req.user.isActive)
      return res.status(403).json({ message: "Account deactivated — contact admin" });
    next();
  } catch {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
};