import jwt from "jsonwebtoken";
import { query } from "../config/db.js";

function mapUserRow(row) {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at || null,
  };
}

async function findUserById(id) {
  const result = await query(
    `
      SELECT id, data, created_at, updated_at
      FROM app_records
      WHERE model = $1 AND id = $2
      LIMIT 1
    `,
    ["user", id]
  );

  return mapUserRow(result.rows[0]);
}

export const verifyToken = async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorised - no token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "Account deactivated - contact admin" });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalid or expired" });
  }
};
