/**
 * @file server.js
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

const log = {
  info:  (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  warn:  (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  ok:    (msg, ...args) => console.log(`[OK]    ${msg}`, ...args),
};

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

app.set("trust proxy", 1);
log.info("NODE_ENV:", process.env.NODE_ENV);

// ── DEBUG: Log every incoming request ────────────────────────────
app.use((req, res, next) => {
  console.log(`\n[REQ] ${req.method} ${req.originalUrl}`);
  console.log(`[REQ] Content-Type: ${req.headers["content-type"] || "none"}`);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    console.log(`[RES] ${req.method} ${req.originalUrl} → ${res.statusCode}`);
    if (res.statusCode >= 400) {
      console.error(`[RES ERROR] Body:`, JSON.stringify(body));
    }
    return originalJson(body);
  };

  next();
});

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
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.options("*", cors());

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

app.use("/api/auth",       authRoutes);
app.use("/api/audit",      auditRoutes);
app.use("/api/clients",    clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

app.get("/api/db-test", asyncHandler(async (req, res) => {
  const result = await query("SELECT NOW() as time");
  res.json({ status: "ok", db_time: result.rows[0].time });
}));

// ── DEBUG: Supabase connection test ──────────────────────────────
app.get("/api/storage-test", asyncHandler(async (req, res) => {
  try {
    const { getSupabaseClient } = await import("./lib/supabase.js");
    const client = getSupabaseClient();
    const { data, error } = await client.storage.listBuckets();
    if (error) {
      console.error("[STORAGE TEST] Error:", error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    console.log("[STORAGE TEST] Buckets:", data);
    res.json({ ok: true, buckets: data });
  } catch (err) {
    console.error("[STORAGE TEST] Exception:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}));

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "CPS API is running" });
});

app.use((req, res) => {
  log.warn("Route not found:", req.method, req.originalUrl);
  res.status(404).json({
    status: "error",
    code: "ROUTE_NOT_FOUND",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;
  const isDev = process.env.NODE_ENV !== "production";

  // ── DEBUG: Full error print ───────────────────────────────────
  console.error(`\n[ERROR HANDLER] ${req.method} ${req.originalUrl}`);
  console.error(`[ERROR HANDLER] Message: ${err.message}`);
  console.error(`[ERROR HANDLER] Stack:\n${err.stack}`);

  const clientMessage = isOperational || isDev
    ? err.message
    : "An unexpected error occurred";

  res.status(statusCode).json({
    status: "error",
    code: err.code || "INTERNAL_ERROR",
    message: clientMessage,
    ...(isDev && { stack: err.stack }),
  });
});

initDB()
  .then(() => log.ok("DB initialised"))
  .catch((err) => log.error("DB init failed:", err.message));

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;

  async function startServer() {
    try {
      await initDB();
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

export { AppError, asyncHandler };
export default app; 