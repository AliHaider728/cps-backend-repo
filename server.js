import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";

const app = express();

app.set("trust proxy", 1);

connectDB();

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

app.use("/api/auth",    authRoutes);
app.use("/api/audit",   auditRoutes);
app.use("/api/clients", clientRoutes);

app.get("/", (_, res) =>
  res.json({ message: "CPS API running ✓", version: "1.0.0" })
);

app.use((_, res) =>
  res.status(404).json({ message: "Route not found" })
);

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
}

export default app;