import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import { initDB, query } from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import complianceDocRoutes from "./routes/complianceDocRoutes.js";

dotenv.config();

const app = express();

// ─────────────────────────────
// TRUST PROXY (Vercel safe)
// ─────────────────────────────
app.set("trust proxy", 1);

// ─────────────────────────────
// CORS (SAFE MODE)
// ─────────────────────────────
app.use(
  cors({
    origin: true, // allow all (debug stable)
    credentials: true,
  })
);

app.options("*", cors());

// ─────────────────────────────
// BODY PARSER
// ─────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────
// RATE LIMIT (SAFE)
// ─────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─────────────────────────────
// ROUTES
// ─────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

// ─────────────────────────────
// DB TEST ROUTE
// ─────────────────────────────
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await query("SELECT NOW() as time");
    res.json({
      status: "ok",
      db_time: result.rows[0].time,
    });
  } catch (err) {
    res.status(500).json({
      status: "failed",
      error: err.message,
    });
  }
});

// ─────────────────────────────
// HEALTH CHECK
// ─────────────────────────────
app.get("/", (req, res) => {
  res.json({
    message: "CPS API running",
    status: "healthy",
  });
});

// ─────────────────────────────
// 404 HANDLER
// ─────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

// ─────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err.message);

  res.status(500).json({
    message: "Internal server error",
    error: err.message,
  });
});

// ─────────────────────────────
// START SERVER
// ─────────────────────────────
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    console.log("Starting server...");

    await initDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("[DB] Init completed");
    });
  } catch (err) {
    console.error("[SERVER FAILED]", err.message);
    process.exit(1);
  }
}

startServer();