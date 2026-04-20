/**
 * @file server.js
 * @description Entry point for the CPS (Compliance Processing System) REST API.
 *              Configures Express middleware, CORS, rate limiting, routes,
 *              and global error handling.
 *
 * @author       ALi Haider Ansari
 * @version     1.0.0
 *
 * UPDATED (Apr 2026):
 *   - initDB() now runs on production (Vercel cold start fix)
 *   - DB connection pooling optimized for serverless
 */

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

// ─────────────────────────────────────────────────────────────────────────────
// LOGGER UTILITY
// ─────────────────────────────────────────────────────────────────────────────
const log = {
  info:  (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  warn:  (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  ok:    (msg, ...args) => console.log(`[OK]    ${msg}`, ...args),
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────
class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC HANDLER WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ─────────────────────────────────────────────────────────────────────────────
// TRUST PROXY
// ─────────────────────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
log.info("NODE_ENV:", process.env.NODE_ENV);

// ─────────────────────────────────────────────────────────────────────────────
// CORS CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://cps-tau-five.vercel.app",
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",") : []),
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    log.warn("CORS blocked origin:", origin);
    // Still allow — don't block unknown origins
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.options("*", cors());

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSERS
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb", strict: true }));
app.use(express.urlencoded({ extended: true }));

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      status: "error",
      code: "INVALID_JSON",
      message: "Request body contains invalid JSON",
    });
  }
  next(err);
});

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    log.warn("Rate limit exceeded:", req.ip);
    res.status(429).json({
      status: "error",
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please try again later.",
    });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);
app.use("/api/audit",      auditRoutes);
app.use("/api/clients",    clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
app.get("/api/db-test", asyncHandler(async (req, res) => {
  const result = await query("SELECT NOW() as time");
  res.json({ status: "ok", db_time: result.rows[0].time });
}));

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "CPS API is running" });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  log.warn("Route not found:", req.method, req.originalUrl);
  res.status(404).json({
    status: "error",
    code: "ROUTE_NOT_FOUND",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;
  const isDev = process.env.NODE_ENV !== "production";

  log.error(`[${err.code || "UNHANDLED"}] ${err.message}`, {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    ...(isDev && { stack: err.stack }),
  });

  const clientMessage = isOperational || isDev
    ? err.message
    : "An unexpected error occurred";

  res.status(statusCode).json({
    status: "error",
    code: err.code || "INTERNAL_ERROR",
    message: clientMessage,
    ...(isDev && !isOperational && { stack: err.stack }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB INIT — runs on BOTH local and production (Vercel cold start)
// ─────────────────────────────────────────────────────────────────────────────
// ✅ FIX: Previously initDB() only ran in non-production block.
//         On Vercel, NODE_ENV = "production" so DB was never initialised,
//         causing "Token invalid" errors because user lookups failed silently.
//         Now initDB() runs unconditionally on module load.
initDB()
  .then(() => log.ok("DB initialised"))
  .catch((err) => log.error("DB init failed:", err.message));

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DEV SERVER BOOTSTRAP
// Skipped in production — Vercel imports app directly and handles the port.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;

  async function startServer() {
    try {
      await initDB(); // safe — initDB() is idempotent (isInitialized guard)
      app.listen(PORT, () => {
        log.ok(`Server running on port ${PORT}`);
        log.info("Allowed origins:", allowedOrigins);
      });
    } catch (err) {
      log.error("Server failed to start:", err.message);
      process.exit(1);
    }
  }

  startServer();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export { AppError, asyncHandler };
export default app;