import dotenv from "dotenv";
dotenv.config();
import mongoose        from "mongoose";
import bcrypt          from "bcryptjs";
import User            from "./models/User.js";
import ICB             from "./models/ICB.js";
import PCN             from "./models/PCN.js";
import Practice        from "./models/Practice.js";
import ContactHistory  from "./models/ContactHistory.js";

// ── USERS ─────────────────────────────────────────────────────────
const USERS = [
  { name: "Super Admin",     email: "superadmin@coreprescribing.co.uk", password: "SuperAdmin@123",  role: "super_admin" },
  { name: "Sarah Director",  email: "director@coreprescribing.co.uk",   password: "Director@123",    role: "director"    },
  { name: "James Ops",       email: "ops@coreprescribing.co.uk",        password: "OpsManager@123",  role: "ops_manager" },
  { name: "Fatema Finance",  email: "finance@coreprescribing.co.uk",    password: "Finance@123",     role: "finance"     },
  { name: "Stacey Training", email: "training@coreprescribing.co.uk",   password: "Training@123",    role: "training"    },
  { name: "Workforce VA",    email: "workforce@coreprescribing.co.uk",  password: "Workforce@123",   role: "workforce"   },
  { name: "Dr. Ali Haider",  email: "clinician@coreprescribing.co.uk",  password: "Clinician@123",   role: "clinician"   },
  { name: "Dr. Sara Malik",  email: "clinician2@coreprescribing.co.uk", password: "Clinician@123",   role: "clinician"   },
];

// ── ICBs ──────────────────────────────────────────────────────────
const ICBS = [
  { name: "NHS Greater Manchester ICB",          region: "North West",           notes: "Largest ICB in the North West region." },
  { name: "NHS Lancashire & South Cumbria ICB",  region: "North West",           notes: "Covers Lancashire and South Cumbria." },
  { name: "NHS Cheshire & Merseyside ICB",       region: "North West",           notes: "Covers Cheshire and Merseyside area." },
  { name: "NHS South Yorkshire ICB",             region: "Yorkshire & Humber",   notes: "South Yorkshire integrated care." },
];

// ── PCNs ──────────────────────────────────────────────────────────
const PCN_DATA = [
  {
    icbName: "NHS Greater Manchester ICB",
    pcns: [
      {
        name: "Salford Central PCN", federation: "Salford Together Federation", annualSpend: 280000,
        notes: "Key PCN — 6 practices, high footfall area.",
        contacts: [
          { name: "Dr. Priya Sharma",  role: "Clinical Director",  email: "priya.sharma@salfordpcn.nhs.uk",  phone: "0161 234 5678", type: "decision_maker" },
          { name: "Kevin Walsh",       role: "PCN Manager",        email: "k.walsh@salfordpcn.nhs.uk",       phone: "0161 234 5679", type: "general"        },
          { name: "Rachel Green",      role: "Finance Lead",       email: "r.green@salfordpcn.nhs.uk",       phone: "0161 234 5680", type: "finance"        },
        ],
      },
      {
        name: "Wythenshawe & Benchill PCN", federation: "Manchester Health & Care Commissioning", annualSpend: 195000,
        notes: "Growing PCN, recently added 2 new practices.",
        contacts: [
          { name: "Dr. Mohammed Iqbal", role: "Clinical Director",  email: "m.iqbal@wythpcn.nhs.uk",   phone: "0161 945 1234", type: "decision_maker" },
          { name: "Sandra Lee",         role: "Ops Manager",        email: "s.lee@wythpcn.nhs.uk",     phone: "0161 945 1235", type: "general"        },
        ],
      },
      {
        name: "Stockport North PCN", federation: "Stockport Together", annualSpend: 165000,
        notes: "Stable PCN, good compliance record.",
        contacts: [
          { name: "Dr. Helen Foster", role: "Clinical Director", email: "h.foster@stocknorth.nhs.uk", phone: "0161 419 7890", type: "decision_maker" },
        ],
      },
    ],
  },
  {
    icbName: "NHS Lancashire & South Cumbria ICB",
    pcns: [
      {
        name: "Preston City PCN", federation: "Lancashire & South Cumbria NHS Foundation Trust", annualSpend: 142000,
        notes: "Urban PCN — strong pharmacist engagement.",
        contacts: [
          { name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", type: "decision_maker" },
          { name: "Lucy Parker",     role: "Finance Contact",   email: "l.parker@prestoncity.nhs.uk",  phone: "01772 555 101", type: "finance"        },
        ],
      },
      {
        name: "Blackpool Central PCN", federation: "Fylde Coast Medical Services", annualSpend: 98000,
        notes: "Coastal PCN, seasonal demand variation.",
        contacts: [
          { name: "Dr. Emma Hall", role: "Clinical Director", email: "e.hall@blackpoolcentral.nhs.uk", phone: "01253 300 200", type: "decision_maker" },
        ],
      },
    ],
  },
  {
    icbName: "NHS Cheshire & Merseyside ICB",
    pcns: [
      {
        name: "Liverpool South PCN", federation: "Cheshire & Wirral Foundation Trust", annualSpend: 220000,
        notes: "High-demand urban PCN.",
        contacts: [
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk",  phone: "0151 233 4000", type: "decision_maker" },
          { name: "Diane Morris",    role: "PCN Manager",       email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general"        },
          { name: "James Wong",      role: "Finance Lead",      email: "j.wong@livsouth.nhs.uk",   phone: "0151 233 4002", type: "finance"        },
        ],
      },
    ],
  },
];

// ── Practices ──────────────────────────────────────────────────────
const PRACTICE_DATA = {
  "Salford Central PCN": [
    { name: "Pendleton Medical Centre",    odsCode: "P84001", address: "15 Broad Street, Salford M6 5BN",     systemAccessNotes: "SystmOne — full access granted" },
    { name: "Weaste & Seedley Surgery",    odsCode: "P84002", address: "42 Liverpool Street, Salford M5 4LT", systemAccessNotes: "EMIS Web — view only" },
    { name: "Salford Royal Practice",      odsCode: "P84003", address: "Stott Lane, Salford M6 8HD",          systemAccessNotes: "SystmOne — shared access agreed" },
  ],
  "Wythenshawe & Benchill PCN": [
    { name: "Benchill Medical Practice",   odsCode: "P84010", address: "Benchill Road, Wythenshawe M22 8LR",  systemAccessNotes: "EMIS Web — full access" },
    { name: "Wythenshawe Health Centre",   odsCode: "P84011", address: "Dobbinetts Lane, Manchester M23 9PT", systemAccessNotes: "SystmOne — awaiting sign off" },
  ],
  "Stockport North PCN": [
    { name: "Heaton Moor Medical Group",   odsCode: "P84020", address: "Heaton Moor Road, Stockport SK4 4NX",  systemAccessNotes: "EMIS Web — full access" },
    { name: "Cheadle Hulme Group Practice",odsCode: "P84021", address: "Church Road, Cheadle Hulme SK8 7JS",   systemAccessNotes: "SystmOne" },
  ],
  "Preston City PCN": [
    { name: "Fishergate Hill Surgery",     odsCode: "P82001", address: "Fishergate Hill, Preston PR1 8JD",     systemAccessNotes: "EMIS Web" },
    { name: "Larches Surgery",             odsCode: "P82002", address: "Blackpool Road, Preston PR2 6AA",      systemAccessNotes: "SystmOne" },
  ],
  "Blackpool Central PCN": [
    { name: "Whitegate Health Centre",     odsCode: "P82010", address: "Whitegate Drive, Blackpool FY3 9ES",   systemAccessNotes: "EMIS Web" },
  ],
  "Liverpool South PCN": [
    { name: "Speke Medical Centre",        odsCode: "P83001", address: "Speke Road, Liverpool L24 2SQ",        systemAccessNotes: "SystmOne" },
    { name: "Aigburth Vale Medical Centre",odsCode: "P83002", address: "Aigburth Road, Liverpool L17 7AD",     systemAccessNotes: "EMIS Web — full access" },
  ],
};

// ── Contact history templates ──────────────────────────────────────
const HISTORY = [
  { type: "meeting",   subject: "Monthly performance review",       notes: "Discussed KPIs for Q1. All targets met. Follow-up scheduled next month." },
  { type: "call",      subject: "Clinician placement query",        notes: "PCN manager called regarding locum cover availability in March." },
  { type: "email",     subject: "Contract renewal discussion",      notes: "Sent updated contract terms. Awaiting sign-off from clinical director." },
  { type: "meeting",   subject: "Quarterly governance meeting",     notes: "Covered safeguarding updates, compliance tracker, new starter onboarding." },
  { type: "complaint", subject: "Complaint: delayed rota",          notes: "PCN reported delay receiving March rota. Escalated to ops. Resolved same day." },
  { type: "note",      subject: "Internal note — billing query",    notes: "Finance contact queried invoice CPS-2024-0043. Confirmed correct." },
  { type: "email",     subject: "Welcome email — new practice",     notes: "Sent welcome pack and system access instructions to new practice manager." },
  { type: "call",      subject: "Urgent absence cover request",     notes: "Cover needed at Pendleton MC on Friday. Arranged successfully." },
  { type: "system_access", subject: "System access request",        notes: "New pharmacist requires EMIS Web read access. Request submitted to IT." },
  { type: "contract",  subject: "Contract amendment signed",        notes: "Mid-contract change agreed — additional 0.5 WTE from April." },
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

// ─────────────────────────────────────────────────────────────────
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✓ MongoDB connected\n");

  // ── 1. Users ──────────────────────────────────────────────────
  console.log("── Seeding Users ──");
  const seededUsers = [];
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 12);
    const user = await User.findOneAndUpdate(
      { email: u.email },
      { ...u, password: hashed, mustChangePassword: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    seededUsers.push(user);
    console.log(`  ✓ ${u.email} [${u.role}]`);
  }
  const admin      = seededUsers.find(u => u.role === "super_admin");
  const clinicians = seededUsers.filter(u => u.role === "clinician");

  // ── 2. ICBs ───────────────────────────────────────────────────
  console.log("\n── Seeding ICBs ──");
  const icbMap = {};
  for (const d of ICBS) {
    const icb = await ICB.findOneAndUpdate(
      { name: d.name },
      { ...d, createdBy: admin._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    icbMap[d.name] = icb;
    console.log(`  ✓ ${d.name}`);
  }

  // ── 3. PCNs ───────────────────────────────────────────────────
  console.log("\n── Seeding PCNs ──");
  const pcnMap = {};
  for (const group of PCN_DATA) {
    const icb = icbMap[group.icbName];
    if (!icb) { console.warn(`  ⚠ ICB not found: ${group.icbName}`); continue; }
    for (const d of group.pcns) {
      const pcn = await PCN.findOneAndUpdate(
        { name: d.name },
        { ...d, icb: icb._id, restrictedClinicians: clinicians.length ? [clinicians[0]._id] : [], createdBy: admin._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      pcnMap[d.name] = pcn;
      console.log(`  ✓ ${d.name}`);
    }
  }

  // ── 4. Practices ──────────────────────────────────────────────
  console.log("\n── Seeding Practices ──");
  const practiceMap = {};
  for (const [pcnName, practices] of Object.entries(PRACTICE_DATA)) {
    const pcn = pcnMap[pcnName];
    if (!pcn) { console.warn(`  ⚠ PCN not found: ${pcnName}`); continue; }
    for (const d of practices) {
      const practice = await Practice.findOneAndUpdate(
        { odsCode: d.odsCode },
        { ...d, pcn: pcn._id, linkedClinicians: clinicians.map(c => c._id), createdBy: admin._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      practiceMap[d.name] = practice;
      console.log(`  ✓ ${d.name}`);
    }
  }

  // ── 5. Contact History ────────────────────────────────────────
  console.log("\n── Seeding Contact History ──");

  // Clear old contact history to avoid duplicates on re-seed
  await ContactHistory.deleteMany({});

  for (const pcn of Object.values(pcnMap)) {
    for (let i = 0; i < 4; i++) {
      const t = rand(HISTORY);
      await ContactHistory.create({
        entityType: "PCN", entityId: pcn._id,
        type: t.type, subject: t.subject, notes: t.notes,
        date: daysAgo(Math.floor(Math.random() * 90)),
        starred: i === 0,
        createdBy: admin._id,
      });
    }
    console.log(`  ✓ History → ${pcn.name}`);
  }

  for (const practice of Object.values(practiceMap)) {
    for (let i = 0; i < 2; i++) {
      const t = rand(HISTORY);
      await ContactHistory.create({
        entityType: "Practice", entityId: practice._id,
        type: t.type, subject: t.subject, notes: t.notes,
        date: daysAgo(Math.floor(Math.random() * 60)),
        starred: false,
        createdBy: admin._id,
      });
    }
  }
  console.log(`  ✓ Practice contact history seeded`);

  await mongoose.disconnect();
  console.log("\n✓ Seed complete! 🎉");
  console.log(`  Users: ${USERS.length} | ICBs: ${ICBS.length} | PCNs: ${Object.values(pcnMap).length} | Practices: ${Object.values(practiceMap).length}`);
})();