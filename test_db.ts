import dotenv from "dotenv";
dotenv.config();

import { query } from "./config/db.js";
import mongoose from "mongoose";
import Clinician from "./models/Clinician.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log("Connected to Mongo");

    const clinMongo = await Clinician.findOne({ email: "abdullah@gmail.com" }).lean();
    console.log("\n--- MONGO DATA ---");
    console.log("Clinician ID:", clinMongo?._id);
    console.log("Clinician user field:", clinMongo?.user);
    console.log("Clinician userId field:", clinMongo?.userId);

    const res = await query("SELECT id, user_id FROM clinicians WHERE email = $1", ["abdullah@gmail.com"]);
    console.log("\n--- POSTGRES DATA ---");
    console.log("Clinician in Postgres:", res.rows[0] || "Not found");
    
    if (res.rows[0]) {
      const userId = res.rows[0].user_id;
      if (userId) {
        const userRes = await query("SELECT id, email FROM users WHERE id = $1", [userId]);
        console.log("Matching user in Postgres:", userRes.rows[0] || "Not found");
      } else {
        console.log("user_id in Postgres is NULL or empty");
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
    process.exit();
  }
}
run();
