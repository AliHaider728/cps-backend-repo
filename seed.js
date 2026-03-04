require("dotenv").config();
const mongoose = require("mongoose");
const User     = require("./models/User");

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
  console.log("✅ MongoDB connected");

  // Pehle sab delete karo
  await User.deleteMany({ email: { $in: USERS.map(u => u.email) } });
  console.log("🗑️  Old users deleted");

  // Phir naye banao — pre('save') hook chalega, password hash hoga
  for (const u of USERS) {
    await User.create(u);
    console.log(`✅ Created: ${u.email} [${u.role}]`);
  }

  await mongoose.disconnect();
  console.log("🎉 Seed complete!");
})();