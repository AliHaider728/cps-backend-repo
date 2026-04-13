import dotenv from "dotenv";
dotenv.config();
import mongoose          from "mongoose";
import bcrypt            from "bcryptjs";
import User              from "./models/User.js";
import ICB               from "./models/ICB.js";
import Federation        from "./models/Federation.js";
import PCN               from "./models/PCN.js";
import Practice          from "./models/Practice.js";
import ContactHistory    from "./models/ContactHistory.js";
import ComplianceDocument from "./models/ComplianceDocument.js";
import DocumentGroup     from "./models/DocumentGroup.js";

// ─────────────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
//  ICBs
// ─────────────────────────────────────────────────────────
const ICBS = [
  { name: "NHS Greater Manchester ICB",         region: "North West",         code: "QOP" },
  { name: "NHS Lancashire & South Cumbria ICB", region: "North West",         code: "QE1" },
  { name: "NHS Cheshire & Merseyside ICB",      region: "North West",         code: "QYG" },
  { name: "NHS South Yorkshire ICB",            region: "Yorkshire & Humber", code: "QF7" },
];

// ─────────────────────────────────────────────────────────
//  FEDERATIONS
// ─────────────────────────────────────────────────────────
const FEDERATION_DATA = [
  { icbName: "NHS Greater Manchester ICB", name: "Salford Together Federation",            type: "federation" },
  { icbName: "NHS Greater Manchester ICB", name: "Manchester Health & Care Commissioning", type: "federation" },
  { icbName: "NHS Greater Manchester ICB", name: "Stockport Together",                     type: "INT"        },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Lancashire & South Cumbria NHS Foundation Trust", type: "federation" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Fylde Coast Medical Services",   type: "federation" },
  { icbName: "NHS Cheshire & Merseyside ICB",      name: "Cheshire & Wirral Foundation Trust", type: "federation" },
];

// ─────────────────────────────────────────────────────────
//  PCNs
// ─────────────────────────────────────────────────────────
const PCN_DATA = [
  {
    icbName: "NHS Greater Manchester ICB",
    federationName: "Salford Together Federation",
    pcns: [
      {
        name: "Salford Central PCN", annualSpend: 280000, contractType: "ARRS",
        xeroCode: "SAL1", xeroCategory: "PCN",
        contractRenewalDate: new Date("2025-04-01"),
        contractExpiryDate:  new Date("2026-03-31"),
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Key PCN — 6 practices, high footfall area.",
        contacts: [
          { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordpcn.nhs.uk", phone: "0161 234 5678", type: "decision_maker" },
          { name: "Kevin Walsh",      role: "PCN Manager",       email: "k.walsh@salfordpcn.nhs.uk",      phone: "0161 234 5679", type: "general"        },
          { name: "Rachel Green",     role: "Finance Lead",      email: "r.green@salfordpcn.nhs.uk",      phone: "0161 234 5680", type: "finance"        },
        ],
        requiredSystems: { emis: true, ice: true, accurx: true, docman: true, vpn: true },
      },
      {
        name: "Wythenshawe & Benchill PCN", annualSpend: 195000, contractType: "EA",
        xeroCode: "WYT1", xeroCategory: "PCN",
        contractRenewalDate: new Date("2025-06-01"),
        contractExpiryDate:  new Date("2026-05-31"),
        ndaSigned: true, dsaSigned: true, mouReceived: false, welcomePackSent: true,
        notes: "Growing PCN, recently added 2 new practices.",
        contacts: [
          { name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythpcn.nhs.uk", phone: "0161 945 1234", type: "decision_maker" },
          { name: "Sandra Lee",         role: "Ops Manager",       email: "s.lee@wythpcn.nhs.uk",   phone: "0161 945 1235", type: "operations"     },
        ],
        requiredSystems: { emis: true, accurx: true },
      },
    ],
  },
  {
    icbName: "NHS Lancashire & South Cumbria ICB",
    federationName: "Lancashire & South Cumbria NHS Foundation Trust",
    pcns: [
      {
        name: "Preston City PCN", annualSpend: 142000, contractType: "Direct",
        xeroCode: "PRE1", xeroCategory: "PCN",
        contractRenewalDate: new Date("2025-10-01"),
        contractExpiryDate:  new Date("2026-09-30"),
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Urban PCN — strong pharmacist engagement.",
        contacts: [
          { name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", type: "decision_maker" },
          { name: "Lucy Parker",     role: "Finance Contact",   email: "l.parker@prestoncity.nhs.uk",  phone: "01772 555 101", type: "finance"        },
        ],
        requiredSystems: { systmOne: true, ice: true, accurx: true },
      },
    ],
  },
  {
    icbName: "NHS Cheshire & Merseyside ICB",
    federationName: "Cheshire & Wirral Foundation Trust",
    pcns: [
      {
        name: "Liverpool South PCN", annualSpend: 220000, contractType: "ARRS",
        xeroCode: "LIV1", xeroCategory: "PCN",
        contractRenewalDate: new Date("2026-01-01"),
        contractExpiryDate:  new Date("2026-12-31"),
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "High-demand urban PCN.",
        contacts: [
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk",  phone: "0151 233 4000", type: "decision_maker" },
          { name: "Diane Morris",    role: "PCN Manager",       email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general"        },
          { name: "James Wong",      role: "Finance Lead",      email: "j.wong@livsouth.nhs.uk",   phone: "0151 233 4002", type: "finance"        },
        ],
        requiredSystems: { systmOne: true, accurx: true, docman: true },
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────
//  PRACTICES
// ─────────────────────────────────────────────────────────
const PRACTICE_DATA = {
  "Salford Central PCN": [
    {
      name: "Pendleton Medical Centre", odsCode: "P84001",
      address: "15 Broad Street", city: "Salford", postcode: "M6 5BN",
      fte: "0.5 FTE (20HRS/WEEK)", contractType: "ARRS",
      xeroCode: "PEN1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      confidentialityFormSigned: true, prescribingPoliciesShared: true, remoteAccessSetup: true,
      systemAccessNotes: "EMIS Web — full access granted. ICE, AccuRx, Docman active.",
      systemAccess: [
        { system: "EMIS",   code: "EMIS/1485566", status: "granted" },
        { system: "ICE",    status: "granted" },
        { system: "AccuRx", status: "granted" },
        { system: "Docman", status: "granted" },
      ],
    },
    {
      name: "Weaste & Seedley Surgery", odsCode: "P84002",
      address: "42 Liverpool Street", city: "Salford", postcode: "M5 4LT",
      fte: "0.4 FTE", contractType: "ARRS",
      xeroCode: "WEA1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "EMIS Web — view only. ICE access requested.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485567", status: "view_only" },
        { system: "ICE",  status: "requested", requestedAt: new Date() },
      ],
    },
  ],
  "Preston City PCN": [
    {
      name: "Fishergate Hill Surgery", odsCode: "P82001",
      address: "Fishergate Hill", city: "Preston", postcode: "PR1 8JD",
      fte: "0.6 FTE", contractType: "Direct",
      xeroCode: "FIS1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      systemAccessNotes: "SystmOne — full access. ICE and AccuRx granted.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "ICE",      status: "granted" },
        { system: "AccuRx",   status: "granted" },
      ],
    },
    {
      name: "Larches Surgery", odsCode: "P82002",
      address: "Blackpool Road", city: "Preston", postcode: "PR2 6AA",
      fte: "0.4 FTE", contractType: "Direct",
      xeroCode: "LAR1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: false, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: false, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "SystmOne — access pending setup.",
      systemAccess: [{ system: "SystmOne", status: "pending" }],
    },
  ],
  "Liverpool South PCN": [
    {
      name: "Speke Medical Centre", odsCode: "P83001",
      address: "Speke Road", city: "Liverpool", postcode: "L24 2SQ",
      fte: "0.5 FTE", contractType: "ARRS",
      xeroCode: "SPE1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      systemAccessNotes: "SystmOne full access. AccuRx active. Docman installed.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "AccuRx",   status: "granted" },
        { system: "Docman",   status: "granted" },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────
//  CONTACT HISTORY TEMPLATES
// ─────────────────────────────────────────────────────────
const HISTORY_TEMPLATES = [
  { type: "meeting",      subject: "Monthly performance review",    notes: "Discussed Q1 KPIs. All targets met. Follow-up scheduled."     },
  { type: "call",         subject: "Clinician placement query",      notes: "PCN manager called regarding locum cover in March."            },
  { type: "email",        subject: "Contract renewal discussion",    notes: "Sent updated terms. Awaiting sign-off from Clinical Director." },
  { type: "complaint",    subject: "Complaint: delayed rota",        notes: "PCN reported delay in March rota. Resolved same day."          },
  { type: "note",         subject: "Internal note — billing query",  notes: "Finance contact queried invoice. Confirmed correct."           },
  { type: "document",     subject: "MOU signed and received",        notes: "MOU received and filed. Contract now complete."                },
  { type: "system_access", subject: "System access request sent",   notes: "EMIS access requested for new clinical pharmacist."            },
];

// ─────────────────────────────────────────────────────────
//  COMPLIANCE DOCUMENTS  (19 docs — CPS screenshots)
// ─────────────────────────────────────────────────────────
const COMPLIANCE_DOCS = [
  { name: "CV",                                         displayOrder: 7,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "DBS Check/Update Service",                   displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Declaration of Interests Form",              displayOrder: 4,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", displayOrder: 0, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "East Lancashire Alliance - Enhanced Access - Key Contacts",             displayOrder: 0, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Enhanced DBS Certificate (cert only)",       displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Enhanced DBS Certitifcate",                  displayOrder: 10, mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Fitness to Practise Form",                   displayOrder: 3,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Health Screening Form",                      displayOrder: 5,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Indemnity Insurance Certificate",            displayOrder: 11, mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Proof of Address",                           displayOrder: 9,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference 1",                                displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference 2",                                displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference Contact Details",                  displayOrder: 12, mandatory: false, expirable: false, active: false, defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Right to Work",                              displayOrder: 8,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Right to Work Check (expired)",              displayOrder: 5,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Signed Confidentiality Statement",           displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Signed Data Protection Statement",           displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Signed Non-Disclosure Agreement",            displayOrder: 6,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
];

// ─────────────────────────────────────────────────────────
//  DOCUMENT GROUPS  (7 groups — CPS screenshots)
// ─────────────────────────────────────────────────────────
const DOCUMENT_GROUPS = [
  {
    name: "Archive/Expired",          displayOrder: 0, active: false,
    docNames: ["Right to Work", "Indemnity Insurance Certificate"],
  },
  {
    name: "Clinical Staff Documents", displayOrder: 1, active: true,
    docNames: [
      "CV", "DBS Check/Update Service", "Declaration of Interests Form",
      "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)",
      "East Lancashire Alliance - Enhanced Access - Key Contacts",
      "Fitness to Practise Form", "Health Screening Form",
      "Reference 1", "Reference 2", "Reference Contact Details",
      "Signed Confidentiality Statement", "Signed Data Protection Statement",
      "Signed Non-Disclosure Agreement",
    ],
  },
  {
    name: "DBS and Update",           displayOrder: 0, active: true,
    docNames: ["DBS Check/Update Service", "Enhanced DBS Certificate (cert only)"],
  },
  {
    name: "DBS cert - no update",     displayOrder: 0, active: true,
    docNames: ["Enhanced DBS Certificate (cert only)"],
  },
  {
    name: "Enhanced Access",          displayOrder: 0, active: true,
    docNames: [
      "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)",
      "East Lancashire Alliance - Enhanced Access - Key Contacts",
    ],
  },
  {
    name: "Non-Clinical Staff",       displayOrder: 0, active: true,
    docNames: [
      "CV", "Signed Confidentiality Statement", "Signed Data Protection Statement",
      "Reference 1", "Reference 2", "Proof of Address",
    ],
  },
  {
    name: "Right to Work Check (Expired)", displayOrder: 0, active: true,
    docNames: ["Right to Work Check (expired)"],
  },
];

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
const rand    = arr => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = n   => new Date(Date.now() - n * 86_400_000);

const makeSeedGroupRecord = ({ groupId, documentId, documentName, expirable, uploadedBy, daysBack = 10 }) => {
  const uploadedAt = daysAgo(daysBack);
  const expiryDate = expirable ? new Date(Date.now() + 180 * 86_400_000) : null;
  const upload = {
    uploadId: new mongoose.Types.ObjectId().toString(),
    fileName: `${String(documentName || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`,
    fileUrl: `https://files.cps.local/${String(groupId)}/${String(documentId)}/${Date.now()}.pdf`,
    mimeType: "application/pdf",
    fileSize: 180000 + Math.floor(Math.random() * 70000),
    status: "uploaded",
    uploadedAt,
    expiryDate,
    renewalDate: null,
    notes: "Seeded upload record",
    reference: `SEED-${String(documentId).slice(-6).toUpperCase()}`,
    uploadedBy,
  };

  return {
    group: groupId,
    document: documentId,
    fileName: upload.fileName,
    fileUrl: upload.fileUrl,
    mimeType: upload.mimeType,
    fileSize: upload.fileSize,
    status: upload.status,
    uploadedAt: upload.uploadedAt,
    expiryDate: upload.expiryDate,
    renewalDate: null,
    notes: upload.notes,
    uploadedBy,
    lastUpdatedBy: uploadedBy,
    uploads: [upload],
  };
};

// ─────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✓ MongoDB connected\n");

  // ── 1. Users ──────────────────────────────────────────
  console.log("── Seeding Users ──");
  const seededUsers = [];
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 12);
    const user   = await User.findOneAndUpdate(
      { email: u.email },
      { ...u, password: hashed, mustChangePassword: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    seededUsers.push(user);
    console.log(`  ✓ ${u.email} [${u.role}]`);
  }
  const admin      = seededUsers.find(u => u.role === "super_admin");
  const clinicians = seededUsers.filter(u => u.role === "clinician");

  // ── 2. ICBs ───────────────────────────────────────────
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

  // ── 3. Federations ────────────────────────────────────
  console.log("\n── Seeding Federations ──");
  const fedMap = {};
  for (const d of FEDERATION_DATA) {
    const icb = icbMap[d.icbName];
    if (!icb) { console.warn(`  ⚠ ICB not found: ${d.icbName}`); continue; }
    const fed = await Federation.findOneAndUpdate(
      { name: d.name, icb: icb._id },
      { name: d.name, icb: icb._id, type: d.type, createdBy: admin._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    fedMap[d.name] = fed;
    console.log(`  ✓ ${d.name} [${d.type}]`);
  }

  // ── 4. PCNs ───────────────────────────────────────────
  console.log("\n── Seeding PCNs ──");
  const pcnMap = {};
  for (const group of PCN_DATA) {
    const icb = icbMap[group.icbName];
    const fed = fedMap[group.federationName];
    if (!icb) { console.warn(`  ⚠ ICB not found: ${group.icbName}`); continue; }
    for (const d of group.pcns) {
      const pcn = await PCN.findOneAndUpdate(
        { name: d.name },
        {
          ...d,
          icb: icb._id,
          federation: fed?._id,
          federationName: group.federationName,
          restrictedClinicians: clinicians.length ? [clinicians[0]._id] : [],
          createdBy: admin._id,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      pcnMap[d.name] = pcn;
      console.log(`  ✓ ${d.name}`);
    }
  }

  // ── 5. Practices ──────────────────────────────────────
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

  // ── 6. Contact History ────────────────────────────────
  console.log("\n── Seeding Contact History ──");
  await ContactHistory.deleteMany({});
  for (const pcn of Object.values(pcnMap)) {
    for (let i = 0; i < 5; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await ContactHistory.create({
        entityType: "PCN", entityId: pcn._id,
        type: t.type, subject: t.subject, notes: t.notes,
        date: daysAgo(Math.floor(Math.random() * 90)),
        time: `${String(Math.floor(Math.random() * 8) + 9).padStart(2, "0")}:${Math.random() > 0.5 ? "00" : "30"}`,
        starred: i === 0,
        createdBy: admin._id,
      });
    }
    console.log(` ✓ History → ${pcn.name}`);
  }
  for (const practice of Object.values(practiceMap)) {
    for (let i = 0; i < 3; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await ContactHistory.create({
        entityType: "Practice", entityId: practice._id,
        type: t.type, subject: t.subject, notes: t.notes,
        date: daysAgo(Math.floor(Math.random() * 60)),
        time: "10:00",
        starred: false,
        createdBy: admin._id,
      });
    }
  }
  console.log("  ✓ Practice history seeded");

  // ── 7. Compliance Documents ───────────────────────────
  console.log("\n── Seeding Compliance Documents ──");
  const docMap = {};
  for (const d of COMPLIANCE_DOCS) {
    const doc = await ComplianceDocument.findOneAndUpdate(
      { name: d.name },
      { ...d, createdBy: admin._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    docMap[d.name] = doc;
    console.log(`  ✓ ${d.name}`);
  }

  // ── 8. Document Groups ────────────────────────────────
  console.log("\n── Seeding Document Groups ──");
  const groupMap = {};
  for (const g of DOCUMENT_GROUPS) {
    const docIds = g.docNames
      .map(n => docMap[n]?._id)
      .filter(Boolean);

    const storedGroup = await DocumentGroup.findOneAndUpdate(
      { name: g.name },
      {
        name: g.name,
        displayOrder: g.displayOrder,
        active: g.active,
        documents: docIds,
        createdBy: admin._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    groupMap[g.name] = storedGroup;
    console.log(`  ✓ ${g.name} (${docIds.length} docs)`);
  }

  // ── Done ──────────────────────────────────────────────
  console.log("\nAssigning compliance groups and seeded groupDocuments...");
  const docsById = {};
  for (const doc of Object.values(docMap)) docsById[String(doc._id)] = doc;

  const pcnPrimaryGroup = groupMap["Clinical Staff Documents"];
  const pcnSecondaryGroup = groupMap["DBS and Update"];
  const practicePrimaryGroup = groupMap["Non-Clinical Staff"] || pcnPrimaryGroup || null;

  for (const pcn of Object.values(pcnMap)) {
    const selectedGroups = [pcnPrimaryGroup, pcnSecondaryGroup].filter(Boolean);
    const selectedGroupIds = selectedGroups.map((group) => group._id);
    const seededRecords = [];

    for (const group of selectedGroups) {
      const docIds = (group.documents || []).map((id) => String(id)).filter(Boolean);
      if (!docIds.length) continue;
      const firstDocId = docIds[0];
      const docDef = docsById[firstDocId];
      seededRecords.push(
        makeSeedGroupRecord({
          groupId: group._id,
          documentId: firstDocId,
          documentName: docDef?.name || "Document",
          expirable: !!docDef?.expirable,
          uploadedBy: admin._id,
          daysBack: 7,
        })
      );
    }

    await PCN.findByIdAndUpdate(
      pcn._id,
      {
        $set: {
          complianceGroups: selectedGroupIds,
          complianceGroup: selectedGroupIds[0] || null,
          groupDocuments: seededRecords,
        },
      },
      { new: true, runValidators: false }
    );
    console.log(`  Seeded PCN groups -> ${pcn.name}`);
  }

  for (const practice of Object.values(practiceMap)) {
    const seededRecords = [];
    if (practicePrimaryGroup) {
      const docIds = (practicePrimaryGroup.documents || []).map((id) => String(id)).filter(Boolean);
      if (docIds.length > 0) {
        const firstDocId = docIds[0];
        const docDef = docsById[firstDocId];
        seededRecords.push(
          makeSeedGroupRecord({
            groupId: practicePrimaryGroup._id,
            documentId: firstDocId,
            documentName: docDef?.name || "Document",
            expirable: !!docDef?.expirable,
            uploadedBy: admin._id,
            daysBack: 5,
          })
        );
      }
    }

    await Practice.findByIdAndUpdate(
      practice._id,
      {
        $set: {
          complianceGroup: practicePrimaryGroup?._id || null,
          groupDocuments: seededRecords,
        },
      },
      { new: true, runValidators: false }
    );
    console.log(`  Seeded Practice group -> ${practice.name}`);
  }

  await mongoose.disconnect();
  console.log("\n✓ Seed complete!");
  console.log(
    `  Users: ${USERS.length} | ICBs: ${ICBS.length} | ` +
    `Federations: ${Object.keys(fedMap).length} | PCNs: ${Object.keys(pcnMap).length} | ` +
    `Practices: ${Object.keys(practiceMap).length} | ` +
    `Compliance Docs: ${COMPLIANCE_DOCS.length} | Document Groups: ${DOCUMENT_GROUPS.length}`
  );
})();



