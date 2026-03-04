require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const connectDB  = require("./config/db");
const authRoutes = require("./routes/authRoutes");

const app = express();
connectDB();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://cps-6ltm.vercel.app",
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use("/api/auth", authRoutes);
app.get("/", (_, res) => res.json({ message: "CPS API running" }));
app.use((_, res) => res.status(404).json({ message: "Route not found" }));

app.listen(process.env.PORT || 5000, () =>
  console.log("Server running...")
);