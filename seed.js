import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./models/User.js";

const USERS = [
  { name: "Super Admin",     email: "superadmin@coreprescribing.co.uk", password: "SuperAdmin@123",  role: "super_admin" },
  { name: "Director",        email: "director@coreprescribing.co.uk",   password: "Director@123",    role: "director"    },
  { name: "Ops Manager",     email: "ops@coreprescribing.co.uk",        password: "OpsManager@123",  role: "ops_manager" },
  { name: "Fatema Finance",  email: "finance@coreprescribing.co.uk",    password: "Finance@123",     role: "finance"     },
  { name: "Stacey Training", email: "training@coreprescribing.co.uk",   password: "Training@123",    role: "training"    },
  { name: "Workforce VA",    email: "workforce@coreprescribing.co.uk",  password: "Workforce@123",   role: "workforce"   },
  { name: "Test Clinician",  email: "clinician@coreprescribing.co.uk",  password: "Clinician@123",   role: "clinician"   },
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✓ MongoDB connected");

  for (const u of USERS) {
    const hashedPassword = await bcrypt.hash(u.password, 12);
    await User.findOneAndUpdate(
      { email: u.email },
      { ...u, password: hashedPassword },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`  ✓ Seeded: ${u.email} [${u.role}]`);
  }

  await mongoose.disconnect();
  console.log("✓ Seed complete!");
})();