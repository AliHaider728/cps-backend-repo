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

/* ===================== LOGGER ===================== */
const log = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  ok: (msg, ...args) => console.log(`[OK] ${msg}`, ...args),
};

/* ===================== CUSTOM ERROR ===================== */
class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

/* ===================== ASYNC HANDLER ===================== */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/* ===================== CONFIG ===================== */
app.set("trust proxy", 1);
log.info("NODE_ENV:", process.env.NODE_ENV);

/* ===================== CORS ===================== */
const exactOrigins = new Set(
  [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://cps-tau-five.vercel.app",
    ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(",") : []),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (exactOrigins.has(origin)) return true;

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

const corsOptionsDelegate = (req, callback) => {
  const requestOrigin = req.header("Origin");
  const allowed = isAllowedOrigin(requestOrigin);

  if (requestOrigin && !allowed) {
    log.warn("CORS blocked:", requestOrigin);
  }

  callback(null, {
    origin: allowed ? requestOrigin || true : false,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  });
};

app.use(cors(corsOptionsDelegate));
app.options("*", cors(corsOptionsDelegate));

/* ===================== BODY PARSER ===================== */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* ===================== INVALID JSON HANDLER ===================== */
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      status: "error",
      code: "INVALID_JSON",
      message: "Invalid JSON format",
    });
  }
  next(err);
});

/* ===================== RATE LIMIT ===================== */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      log.warn("Rate limit hit:", req.ip);
      res.status(429).json({
        status: "error",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests",
      });
    },
  })
);

/* ===================== ROUTES ===================== */
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

/* ===================== HEALTH CHECK ===================== */
app.get(
  "/api/db-test",
  asyncHandler(async (req, res) => {
    const result = await query("SELECT NOW() as time");
    res.json({ status: "ok", db_time: result.rows[0].time });
  })
);

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "CPS API is running 🚀" });
});

/* ===================== 404 ===================== */
app.use((req, res) => {
  log.warn("Route not found:", req.method, req.originalUrl);
  res.status(404).json({
    status: "error",
    code: "ROUTE_NOT_FOUND",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

/* ===================== GLOBAL ERROR HANDLER ===================== */
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const isDev = process.env.NODE_ENV !== "production";

  log.error(err.message, {
    path: req.originalUrl,
    method: req.method,
    ...(isDev && { stack: err.stack }),
  });

  res.status(statusCode).json({
    status: "error",
    code: err.code || "INTERNAL_ERROR",
    message: isDev ? err.message : "Something went wrong",
    ...(isDev && { stack: err.stack }),
  });
});

/* ===================== SERVER START ===================== */
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await initDB();
    log.ok("DB connected");

    app.listen(PORT, () => {
      log.ok(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    log.error("Startup failed:", err.message);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== "production") {
  startServer();
}

/* ===================== EXPORTS ===================== */
export { AppError, asyncHandler };
export default app;