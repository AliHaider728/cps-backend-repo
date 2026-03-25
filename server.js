import dotenv from "dotenv";
dotenv.config()
import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";

const app = express();

// ── DB  
connectDB();

// ── CORS ─────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://cps-tau-five.vercel.app",
  "https://cps-8gcli4794-alis-projects-58e3c939.vercel.app",
];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.options("*", cors());

// ── GLOBAL RATE LIMIT (all routes) ──────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});
app.use(globalLimiter);

// ── BODY PARSING ────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── ROUTES ───────────────────────────────────────────────────────
app.use("/api/auth",  authRoutes);
app.use("/api/audit", auditRoutes);

app.get("/", (_, res) => res.json({ message: "CPS API running ✓", version: "1.0.0" }));
app.use((_, res) => res.status(404).json({ message: "Route not found" }));

// ── START ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));