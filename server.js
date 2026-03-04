require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const connectDB  = require("./config/db");
const authRoutes = require("./routes/authRoutes");

const app = express();
connectDB();
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use("/api/auth", authRoutes);
app.get("/", (_, res) => res.json({ message: "CPS API running" }));
app.use((_, res) => res.status(404).json({ message: "Route not found" }));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(` Server on http://localhost:${PORT}`));