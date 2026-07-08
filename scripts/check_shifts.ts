import dotenv from "dotenv";
dotenv.config();

import { query } from "../config/db.js";

async function run() {
  try {
    const res = await query("SELECT * FROM shifts ORDER BY date DESC LIMIT 1");
    console.log("shifts keys:", Object.keys(res.rows[0] || {}));
    console.log("data:", res.rows[0]);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
