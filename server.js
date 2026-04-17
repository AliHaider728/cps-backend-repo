/**
 * @file server.js
 * @description Entry point for the CPS (Compliance Processing System) REST API.
 *              Configures Express middleware, CORS, rate limiting, routes,
 *              and global error handling.
 *
 * @author       ALi Haider Ansari
 * @version     1.0.0
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
// A lightweight structured logger that prefixes every console message with a
// severity tag ([INFO], [WARN], [ERROR], [OK]) for easy log filtering in
// production dashboards (e.g. Railway, Render, Papertrail).
// ─────────────────────────────────────────────────────────────────────────────
const log = {
  info:  (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  warn:  (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  ok:    (msg, ...args) => console.log(`[OK]    ${msg}`, ...args),
};

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ERROR CLASS
// Extends the native Error with an HTTP statusCode, a machine-readable code
// string, and an isOperational flag.
//
//  - isOperational: true  → known, expected error (e.g. 404, validation fail).
//                           Safe to send the message directly to the client.
//  - isOperational: false → unexpected/programmer error.
//                           Message is hidden in production to avoid leaking
//                           internal details.
//
// Usage in any route or service:
//   throw new AppError("User not found", 404, "USER_NOT_FOUND");
// ─────────────────────────────────────────────────────────────────────────────
class AppError extends Error {
  /**
   * @param {string} message    - Human-readable error description.
   * @param {number} statusCode - HTTP status code (default: 500).
   * @param {string} code       - Machine-readable error code (default: "INTERNAL_ERROR").
   */
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC HANDLER WRAPPER
// Wraps an async Express route handler so any rejected promise is forwarded to
// Express's next(err) — eliminating repetitive try/catch blocks in every route.
//
// Usage:
//   router.get("/path", asyncHandler(async (req, res) => { ... }));
// ─────────────────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ─────────────────────────────────────────────────────────────────────────────
// TRUST PROXY
// Required when running behind a reverse proxy (Nginx, Render, Railway, etc.)
// so that req.ip returns the real client IP instead of the proxy's address.
// This is also needed for express-rate-limit to work correctly.
// ─────────────────────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
log.info("NODE_ENV:", process.env.NODE_ENV);

// ─────────────────────────────────────────────────────────────────────────────
// CORS CONFIGURATION
// Whitelists specific origins. Additional origins can be injected at runtime
// via the CLIENT_URL environment variable (comma-separated list).
//
// Blocked origins are only logged — the server does NOT crash or return an
// error to avoid breaking legitimate pre-flight requests from unknown proxies.
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:5173",          // Vite dev server
  "http://localhost:3000",          // CRA / alternate dev port
  "https://cps-tau-five.vercel.app", // Production frontend
  // Merge any extra origins supplied via environment variable
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",") : []),
].filter(Boolean); // Remove empty strings

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server requests (no Origin header)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Log the blocked origin for auditing but do not reject the request
    log.warn("CORS blocked origin:", origin);
    return callback(null, true);
  },
  credentials: true, // Required for cookies / Authorization headers
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Respond to all pre-flight OPTIONS requests globally
app.options("*", cors());

// ─────────────────────────────────────────────────────────────────────────────
// BODY PARSERS
// - JSON limit set to 10 mb to support document uploads encoded in JSON.
// - strict: true rejects anything that is not an object or array at the top
//   level, protecting against primitive injection attacks.
// - urlencoded parser is kept for HTML form compatibility.
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({
  limit: "10mb",
  strict: true,
}));

app.use(express.urlencoded({ extended: true }));

/**
 * Malformed JSON error handler.
 * express.json() throws a SyntaxError when the body is not valid JSON.
 * This middleware intercepts that specific error before it reaches the
 * global error handler, returning a clear 400 response to the client.
 */
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
// Limits each IP to 200 requests per 15-minute window.
// - standardHeaders: true  → sends RateLimit-* headers (RFC 6585 compliant).
// - legacyHeaders: false   → disables deprecated X-RateLimit-* headers.
// The custom handler returns a structured JSON error instead of plain text.
// ─────────────────────────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
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
// Each feature domain is isolated in its own router module under /routes/.
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/auth",       authRoutes);          // Authentication & authorization
app.use("/api/audit",      auditRoutes);         // Audit trail / activity logs
app.use("/api/clients",    clientRoutes);        // Client management
app.use("/api/compliance", complianceDocRoutes); // Compliance documents

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/db-test
 * Verifies that the database connection is alive by running a lightweight
 * query. Used by uptime monitors and deployment pipelines.
 */
app.get("/api/db-test", asyncHandler(async (req, res) => {
  const result = await query("SELECT NOW() as time");
  res.json({
    status: "ok",
    db_time: result.rows[0].time,
  });
}));

/**
 * GET /
 * Root ping endpoint. Confirms the API process is running.
 */
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "CPS API is running" });
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 HANDLER
// Catches every request that did not match any route above.
// Logs the method + path for debugging unexpected client calls.
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
// Express identifies a 4-argument middleware as an error handler.
// All errors forwarded via next(err) — including those from asyncHandler —
// land here.
//
// Behaviour:
//  - Operational errors (AppError with isOperational: true):
//      → Always send the real message to the client.
//  - Unexpected errors (isOperational: false or plain Error):
//      → In development: send message + stack trace for easier debugging.
//      → In production:  send a generic message to avoid leaking internals.
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;
  const isDev = process.env.NODE_ENV !== "production";

  // Structured server-side log for every error
  log.error(`[${err.code || "UNHANDLED"}] ${err.message}`, {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    ...(isDev && { stack: err.stack }),
  });

  // Decide what message is safe to expose to the client
  const clientMessage = isOperational || isDev
    ? err.message
    : "An unexpected error occurred";

  res.status(statusCode).json({
    status: "error",
    code: err.code || "INTERNAL_ERROR",
    message: clientMessage,
    // Expose stack trace only in development for non-operational errors
    ...(isDev && !isOperational && { stack: err.stack }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVER BOOTSTRAP  (skipped in production — process manager handles startup)
// In production environments (Railway, Render, etc.) the platform imports
// server.js directly and binds to its own port. This block only runs locally.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;

  /**
   * Initialises the database connection pool, then starts the HTTP server.
   * If DB init fails the process exits with code 1 so the dev is notified
   * immediately instead of receiving cryptic query errors at runtime.
   */
  async function startServer() {
    try {
      await initDB();
      app.listen(PORT, () => {
        log.ok(`Server running on port ${PORT}`);
        log.info("Allowed origins:", allowedOrigins);
      });
    } catch (err) {
      log.error("Server failed to start:", err.message);
      process.exit(1); // Hard exit — no point running without a DB
    }
  }

  startServer();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// AppError and asyncHandler are exported so route files can import them
// directly without creating circular dependencies.
// ─────────────────────────────────────────────────────────────────────────────
export { AppError, asyncHandler };
export default app;