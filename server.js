import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pathToFileURL } from "url";
import connectDB, { isDbConnected } from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import complianceDocRoutes from "./routes/complianceDocRoutes.js";

const app = express();

app.set("trust proxy", 1);

connectDB().catch((err) => {
  console.error("[startup] Initial database connection failed:", err.message);
});

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://cps-tau-five.vercel.app",
  "https://cps-8gcli4794-alis-projects-58e3c939.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

app.use(globalLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error(`[db] Request blocked for ${req.method} ${req.originalUrl}:`, err.message);
    res.status(503).json({ message: "Database connection unavailable" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

app.get("/", (_, res) =>
  res.json({
    message: "CPS API running",
    version: "1.0.0",
    database: isDbConnected() ? "connected" : "disconnected",
  })
);

app.use((_, res) =>
  res.status(404).json({ message: "Route not found" })
);

app.use((err, req, res, _next) => {
  console.error(`[server] Unhandled error for ${req.method} ${req.originalUrl}:`, err.stack || err.message);
  const status = err.statusCode || 500;
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message,
  });
});

const DEFAULT_PORT = Number(process.env.PORT) || 5000;
const SERVER_KEY = "__cps_backend_server__";
const STARTING_KEY = "__cps_backend_server_starting__";

function isDirectRun() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

function attachShutdownHandlers(server) {
  if (server.__shutdownHandlersAttached) return;
  server.__shutdownHandlersAttached = true;

  const closeServer = (signal, next) => {
    if (!globalThis[SERVER_KEY]) {
      if (typeof next === "function") next();
      return;
    }

    console.log(`[server] Shutting down on ${signal}`);
    server.close(() => {
      globalThis[SERVER_KEY] = null;
      if (typeof next === "function") next();
    });
  };

  process.once("SIGINT", () => closeServer("SIGINT", () => process.exit(0)));
  process.once("SIGTERM", () => closeServer("SIGTERM", () => process.exit(0)));
  process.once("SIGUSR2", () => closeServer("SIGUSR2", () => process.kill(process.pid, "SIGUSR2")));
}

export async function startServer(port = DEFAULT_PORT) {
  if (globalThis[SERVER_KEY]) {
    return globalThis[SERVER_KEY];
  }

  if (globalThis[STARTING_KEY]) {
    return globalThis[STARTING_KEY];
  }

  globalThis[STARTING_KEY] = new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once("listening", () => {
      console.log(`Server running on port ${port}`);
      globalThis[SERVER_KEY] = server;
      globalThis[STARTING_KEY] = null;
      attachShutdownHandlers(server);
      resolve(server);
    });

    server.once("error", (err) => {
      globalThis[STARTING_KEY] = null;
      if (err.code === "EADDRINUSE") {
        console.warn(`[server] Port ${port} is already in use. Another backend instance is likely running, so this process will not crash.`);
        resolve(null);
        return;
      }
      reject(err);
    });
  });

  return globalThis[STARTING_KEY];
}

if (process.env.NODE_ENV !== "production" && isDirectRun()) {
  startServer().catch((err) => {
    console.error("[server] Failed to start:", err.stack || err.message);
    process.exit(1);
  });
}

export default app;
