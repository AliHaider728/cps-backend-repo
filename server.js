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

app.set("trust proxy", 1);

// CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://cps-tau-five.vercel.app",
  ...(process.env.CLIENT_URL || "").split(",").map(o => o.trim()).filter(Boolean),
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn("CORS blocked:", origin);
    return callback(new Error("CORS not allowed"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.options("*", cors());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/compliance", complianceDocRoutes);

// DB Test + Health
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await query("SELECT NOW() as time");
    res.json({ status: "ok", db_time: result.rows[0].time });
  } catch (err) {
    console.error("DB Test Error:", err.message);
    res.status(500).json({ status: "failed", error: err.message });
  }
});

app.get("/", (req, res) => res.json({ message: "CPS API running ✅" }));

// 404 + Error handler
app.use((req, res) => res.status(404).json({ message: "Route not found" }));

app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err.message);
  res.status(500).json({ message: "Internal server error" });
});

// ─────────────────────────────
// LOCAL vs VERCEL
// ─────────────────────────────
if (process.env.NODE_ENV !== "production") {
  // ←←← LOCAL DEVELOPMENT (npm run dev)
  const PORT = process.env.PORT || 5000;
  async function startServer() {
    try {
      await initDB();                    // ← yahin se terminal mein log dikhega
      app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log("✅ Allowed Origins:", allowedOrigins);
      });
    } catch (err) {
      console.error("❌ SERVER FAILED", err.message);
    }
  }
  startServer();
}

// VERCEL (production) ke liye
export default app;