import axios from "axios";

const BASE_URL = "http://localhost:5000/api";
let clinicianToken = "";
let adminToken = "";
let clinicianId = "";

async function runTest() {
  try {
    console.log("1. Logging in as Clinician...");
    const clRes = await axios.post("\/auth/login", {
      email: "clinician@example.com", // or whoever Zavior is
      password: "password123" // Wait, I might not know the exact credentials.
    });
    // Let's use db direct login or just use my test script earlier.
  } catch(e) {
    console.error(e);
  }
}
runTest();
