import dotenv from "dotenv";
dotenv.config();

import { query } from "../config/db.js";

async function run() {
  try {
    const userRes = await query("SELECT id, email FROM users WHERE id = $1", ["c20e5e43-91aa-49ba-916d-7e64546e2594"]);
    console.log("Matching user in Postgres:", userRes.rows[0] || "Not found in users table");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
