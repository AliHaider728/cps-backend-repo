import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";

const app = express();

// ── TRUST PROXY (IMPORTANT FOR DEPLOY)
app.set("trust proxy", 1);

// ── DB
connectDB();

// ── CORS (dynamic from env)
const ALLOWED_ORIGINS = process.env.CLIENT_URL.split(",");

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

app.options("*", cors());

// ── GLOBAL RATE LIMIT
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

app.use(globalLimiter);

// ── BODY PARSING
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditRoutes);

app.get("/", (_, res) =>
  res.json({ message: "CPS API running ✓", version: "1.0.0" })
);

app.use((_, res) =>
  res.status(404).json({ message: "Route not found" })
);

// ── START
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✓ Server running on port ${PORT}`)
);