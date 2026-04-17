/**
 * @file seed.js
 * @description Populates the PostgreSQL database (app_records table) with
 *              realistic demo data for all CPS entities.
 *
 *              Previously this file used Mongoose models — it has been fully
 *              migrated to raw PostgreSQL queries so seed data lands in the
 *              same app_records table that the API reads from.
 *
 * Run locally:  node seed.js
 * Run via npm:  npm run seed
 */

import dotenv from "dotenv";
dotenv.config();

import bcrypt    from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { initDB, query, disconnectDB } from "./config/db.js";
import { createId } from "./lib/ids.js";

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED LOGGER  (no emojis — matches server.js convention)
// ─────────────────────────────────────────────────────────────────────────────
const log = {
  info:  (msg, ...a) => console.log(`[INFO]  ${msg}`, ...a),
  ok:    (msg, ...a) => console.log(`[OK]    ${msg}`, ...a),
  warn:  (msg, ...a) => console.warn(`[WARN]  ${msg}`, ...a),
  error: (msg, ...a) => console.error(`[ERROR] ${msg}`, ...a),
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC app_records HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function insertRecord(model, payload) {
  const id        = uuidv4();
  const timestamp = new Date().toISOString();
  const data      = { ...payload, createdAt: timestamp, updatedAt: timestamp };

  await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
    [model, id, JSON.stringify(data)]
  );

  return { _id: id, id, ...data };
}

async function updateRecord(model, id, patch) {
  const data = { ...patch, updatedAt: new Date().toISOString() };

  await query(
    `UPDATE app_records
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE model = $1 AND id = $2`,
    [model, id, JSON.stringify(data)]
  );
}

async function findByField(model, field, value) {
  const result = await query(
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE model = $1
       AND LOWER(COALESCE(data->>'${field}', '')) = LOWER($2)
     LIMIT 1`,
    [model, String(value)]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { _id: row.id, id: row.id, ...row.data };
}

async function upsertRecord(model, matchField, matchValue, payload) {
  const existing = await findByField(model, matchField, matchValue);

  if (existing) {
    await updateRecord(model, existing.id, payload);
    return { ...existing, ...payload };
  }

  return insertRecord(model, payload);
}

async function deleteAllByModel(model) {
  await query(`DELETE FROM app_records WHERE model = $1`, [model]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────

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

const ICBS = [
  { name: "NHS Greater Manchester ICB",         region: "North West",         code: "QOP" },
  { name: "NHS Lancashire & South Cumbria ICB", region: "North West",         code: "QE1" },
  { name: "NHS Cheshire & Merseyside ICB",      region: "North West",         code: "QYG" },
  { name: "NHS South Yorkshire ICB",            region: "Yorkshire & Humber", code: "QF7" },
];

const FEDERATION_DATA = [
  { icbName: "NHS Greater Manchester ICB",         name: "Salford Together Federation",                          type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Manchester Health & Care Commissioning",               type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Stockport Together",                                   type: "INT"        },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Lancashire & South Cumbria NHS Foundation Trust",      type: "federation" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Fylde Coast Medical Services",                        type: "federation" },
  { icbName: "NHS Cheshire & Merseyside ICB",      name: "Cheshire & Wirral Foundation Trust",                  type: "federation" },
];

const CLIENT_DATA = [
  {
    icbName: "NHS Greater Manchester ICB",
    federationName: "Salford Together Federation",
    clients: [
      {
        name: "Salford Central Client", annualSpend: 280000, contractType: "ARRS",
        xeroCode: "SAL1", xeroCategory: "Client",
        contractRenewalDate: "2025-04-01", contractExpiryDate: "2026-03-31",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Key Client — 6 practices, high footfall area.",
        contacts: [
          { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordclient.nhs.uk", phone: "0161 234 5678", type: "decision_maker" },
          { name: "Kevin Walsh",      role: "Client Manager",     email: "k.walsh@salfordclient.nhs.uk",      phone: "0161 234 5679", type: "general"        },
          { name: "Rachel Green",     role: "Finance Lead",       email: "r.green@salfordclient.nhs.uk",      phone: "0161 234 5680", type: "finance"        },
        ],
        requiredSystems: { emis: true, ice: true, accurx: true, docman: true, vpn: true },
      },
      {
        name: "Wythenshawe & Benchill Client", annualSpend: 195000, contractType: "EA",
        xeroCode: "WYT1", xeroCategory: "Client",
        contractRenewalDate: "2025-06-01", contractExpiryDate: "2026-05-31",
        ndaSigned: true, dsaSigned: true, mouReceived: false, welcomePackSent: true,
        notes: "Growing Client, recently added 2 new practices.",
        contacts: [
          { name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythclient.nhs.uk", phone: "0161 945 1234", type: "decision_maker" },
          { name: "Sandra Lee",         role: "Ops Manager",       email: "s.lee@wythclient.nhs.uk",   phone: "0161 945 1235", type: "operations"     },
        ],
        requiredSystems: { emis: true, accurx: true },
      },
    ],
  },
  {
    icbName: "NHS Lancashire & South Cumbria ICB",
    federationName: "Lancashire & South Cumbria NHS Foundation Trust",
    clients: [
      {
        name: "Preston City Client", annualSpend: 142000, contractType: "Direct",
        xeroCode: "PRE1", xeroCategory: "Client",
        contractRenewalDate: "2025-10-01", contractExpiryDate: "2026-09-30",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Urban Client — strong pharmacist engagement.",
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
    clients: [
      {
        name: "Liverpool South Client", annualSpend: 220000, contractType: "ARRS",
        xeroCode: "LIV1", xeroCategory: "Client",
        contractRenewalDate: "2026-01-01", contractExpiryDate: "2026-12-31",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "High-demand urban Client.",
        contacts: [
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk",  phone: "0151 233 4000", type: "decision_maker" },
          { name: "Diane Morris",    role: "Client Manager",     email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general"        },
          { name: "James Wong",      role: "Finance Lead",       email: "j.wong@livsouth.nhs.uk",   phone: "0151 233 4002", type: "finance"        },
        ],
        requiredSystems: { systmOne: true, accurx: true, docman: true },
      },
    ],
  },
];

const PRACTICE_DATA = {
  "Salford Central Client": [
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
        { system: "ICE",  status: "requested"  },
      ],
    },
  ],
  "Preston City Client": [
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
  "Liverpool South Client": [
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

const HISTORY_TEMPLATES = [
  { type: "meeting",       subject: "Monthly performance review",   notes: "Discussed Q1 KPIs. All targets met. Follow-up scheduled."     },
  { type: "call",          subject: "Clinician placement query",     notes: "Client manager called regarding locum cover in March."         },
  { type: "email",         subject: "Contract renewal discussion",   notes: "Sent updated terms. Awaiting sign-off from Clinical Director." },
  { type: "complaint",     subject: "Complaint: delayed rota",       notes: "Client reported delay in March rota. Resolved same day."       },
  { type: "note",          subject: "Internal note — billing query", notes: "Finance contact queried invoice. Confirmed correct."           },
  { type: "document",      subject: "MOU signed and received",       notes: "MOU received and filed. Contract now complete."                },
  { type: "system_access", subject: "System access request sent",    notes: "EMIS access requested for new clinical pharmacist."            },
];

const COMPLIANCE_DOCS = [
  { name: "CV",                                                                    displayOrder: 7,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "DBS Check/Update Service",                                              displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Declaration of Interests Form",                                         displayOrder: 4,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "East Lancashire Alliance - Enhanced Access - Key Contacts",             displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Enhanced DBS Certificate (cert only)",                                  displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Enhanced DBS Certitifcate",                                             displayOrder: 10, mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Fitness to Practise Form",                                              displayOrder: 3,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Health Screening Form",                                                 displayOrder: 5,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Indemnity Insurance Certificate",                                       displayOrder: 11, mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Proof of Address",                                                      displayOrder: 9,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference 1",                                                           displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference 2",                                                           displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Reference Contact Details",                                             displayOrder: 12, mandatory: false, expirable: false, active: false, defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Right to Work",                                                         displayOrder: 8,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Right to Work Check (expired)",                                         displayOrder: 5,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28 },
  { name: "Signed Confidentiality Statement",                                      displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Signed Data Protection Statement",                                      displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
  { name: "Signed Non-Disclosure Agreement",                                       displayOrder: 6,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0  },
];

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

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const rand    = arr => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = n   => new Date(Date.now() - n * 86_400_000).toISOString();

const makeSeedGroupRecord = ({ groupId, documentId, documentName, expirable, uploadedBy, daysBack = 10 }) => {
  const uploadedAt = daysAgo(daysBack);
  const expiryDate = expirable
    ? new Date(Date.now() + 180 * 86_400_000).toISOString()
    : null;

  const upload = {
    uploadId:   createId(),
    fileName:   `${String(documentName || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`,
    fileUrl:    `https://files.cps.local/${groupId}/${documentId}/${Date.now()}.pdf`,
    mimeType:   "application/pdf",
    fileSize:   180000 + Math.floor(Math.random() * 70000),
    status:     "uploaded",
    uploadedAt,
    expiryDate,
    renewalDate: null,
    notes:      "Seeded upload record",
    reference:  `SEED-${String(documentId).slice(-6).toUpperCase()}`,
    uploadedBy,
  };

  return {
    group:         groupId,
    document:      documentId,
    fileName:      upload.fileName,
    fileUrl:       upload.fileUrl,
    mimeType:      upload.mimeType,
    fileSize:      upload.fileSize,
    status:        upload.status,
    uploadedAt:    upload.uploadedAt,
    expiryDate:    upload.expiryDate,
    renewalDate:   null,
    notes:         upload.notes,
    uploadedBy,
    lastUpdatedBy: uploadedBy,
    uploads:       [upload],
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SEED FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
export async function runSeed() {
  await initDB();
  log.ok("PostgreSQL connected");

  // ── 1. Users ──────────────────────────────────────────────────────────────
  log.info("Seeding Users...");
  const seededUsers = [];

  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 12);
    const user   = await upsertRecord("user", "email", u.email.toLowerCase(), {
      name:                u.name,
      email:               u.email.trim().toLowerCase(),
      password:            hashed,
      role:                u.role,
      isActive:            true,
      mustChangePassword:  false,
      isAnonymised:        false,
      lastLogin:           null,
    });

    seededUsers.push(user);
    log.ok(`${u.email} [${u.role}]`);
  }

  const admin      = seededUsers.find(u => u.role === "super_admin");
  const clinicians = seededUsers.filter(u => u.role === "clinician");

  // ── 2. ICBs ───────────────────────────────────────────────────────────────
  log.info("\nSeeding ICBs...");
  const icbMap = {};

  for (const d of ICBS) {
    const icb = await upsertRecord("icb", "name", d.name, {
      ...d,
      createdBy: admin.id,
    });
    icbMap[d.name] = icb;
    log.ok(d.name);
  }

  // ── 3. Federations ────────────────────────────────────────────────────────
  log.info("\nSeeding Federations...");
  const fedMap = {};

  for (const d of FEDERATION_DATA) {
    const icb = icbMap[d.icbName];
    if (!icb) { log.warn(`ICB not found: ${d.icbName}`); continue; }

    const fed = await upsertRecord("federation", "name", d.name, {
      name:      d.name,
      icb:       icb.id,
      type:      d.type,
      createdBy: admin.id,
    });
    fedMap[d.name] = fed;
    log.ok(`${d.name} [${d.type}]`);
  }

  // ── 4. Clients ────────────────────────────────────────────────────────────
  // FIX: Store icb and federation as populated objects { _id, id, name }
  // so frontend client.icb?.name and client.federation?.name resolve correctly.
  // ──────────────────────────────────────────────────────────────────────────
  log.info("\nSeeding Clients...");
  const clientMap = {};

  for (const group of CLIENT_DATA) {
    const icb = icbMap[group.icbName];
    const fed = fedMap[group.federationName];
    if (!icb) { log.warn(`ICB not found: ${group.icbName}`); continue; }

    for (const d of group.clients) {
      const client = await upsertRecord("client", "name", d.name, {
        ...d,
        // ✅ FIX: store populated objects instead of raw UUID strings
        icb: {
          _id:  icb.id,
          id:   icb.id,
          name: icb.name,
          code: icb.code,
        },
        federation: fed
          ? { _id: fed.id, id: fed.id, name: fed.name, type: fed.type }
          : null,
        federationName:        group.federationName,
        restrictedClinicians:  clinicians.length ? [clinicians[0].id] : [],
        createdBy:             admin.id,
      });
      clientMap[d.name] = client;
      log.ok(d.name);
    }
  }

  // ── 5. Practices ──────────────────────────────────────────────────────────
  log.info("\nSeeding Practices...");
  const practiceMap = {};

  for (const [clientName, practices] of Object.entries(PRACTICE_DATA)) {
    const client = clientMap[clientName];
    if (!client) { log.warn(`Client not found: ${clientName}`); continue; }

    for (const d of practices) {
      const practice = await upsertRecord("practice", "odsCode", d.odsCode, {
        ...d,
        // ✅ FIX: store populated client object so practice detail pages work too
        client: {
          _id:  client.id,
          id:   client.id,
          name: client.name,
        },
        linkedClinicians: clinicians.map(c => c.id),
        createdBy:        admin.id,
      });
      practiceMap[d.name] = practice;
      log.ok(d.name);
    }
  }

  // ── 6. Contact History ────────────────────────────────────────────────────
  log.info("\nSeeding Contact History...");
  await deleteAllByModel("contact_history");

  for (const client of Object.values(clientMap)) {
    for (let i = 0; i < 5; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await insertRecord("contact_history", {
        entityType: "Client",
        entityId:   client.id,
        type:       t.type,
        subject:    t.subject,
        notes:      t.notes,
        date:       daysAgo(Math.floor(Math.random() * 90)),
        time:       `${String(Math.floor(Math.random() * 8) + 9).padStart(2, "0")}:${Math.random() > 0.5 ? "00" : "30"}`,
        starred:    i === 0,
        createdBy:  admin.id,
      });
    }
    log.ok(`History seeded for ${client.name}`);
  }

  for (const practice of Object.values(practiceMap)) {
    for (let i = 0; i < 3; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await insertRecord("contact_history", {
        entityType: "Practice",
        entityId:   practice.id,
        type:       t.type,
        subject:    t.subject,
        notes:      t.notes,
        date:       daysAgo(Math.floor(Math.random() * 60)),
        time:       "10:00",
        starred:    false,
        createdBy:  admin.id,
      });
    }
  }
  log.ok("Practice history seeded");

  // ── 7. Compliance Documents ───────────────────────────────────────────────
  log.info("\nSeeding Compliance Documents...");
  const docMap = {};

  for (const d of COMPLIANCE_DOCS) {
    const doc = await upsertRecord("compliance_document", "name", d.name, {
      ...d,
      createdBy: admin.id,
    });
    docMap[d.name] = doc;
    log.ok(d.name);
  }

  // ── 8. Document Groups ────────────────────────────────────────────────────
  log.info("\nSeeding Document Groups...");
  const groupMap = {};

  for (const g of DOCUMENT_GROUPS) {
    const docIds = g.docNames.map(n => docMap[n]?.id).filter(Boolean);

    const group = await upsertRecord("document_group", "name", g.name, {
      name:         g.name,
      displayOrder: g.displayOrder,
      active:       g.active,
      documents:    docIds,
      createdBy:    admin.id,
    });
    groupMap[g.name] = group;
    log.ok(`${g.name} (${docIds.length} docs)`);
  }

  // ── 9. Assign Compliance Groups to Clients & Practices ───────────────────
  log.info("\nAssigning compliance groups...");

  const docsById               = Object.fromEntries(Object.values(docMap).map(d => [d.id, d]));
  const clientPrimaryGroup     = groupMap["Clinical Staff Documents"];
  const clientSecondaryGroup   = groupMap["DBS and Update"];
  const practicePrimaryGroup   = groupMap["Non-Clinical Staff"] || clientPrimaryGroup || null;

  for (const client of Object.values(clientMap)) {
    const selectedGroups   = [clientPrimaryGroup, clientSecondaryGroup].filter(Boolean);
    const selectedGroupIds = selectedGroups.map(g => g.id);
    const seededRecords    = [];

    for (const group of selectedGroups) {
      const docIds = (group.documents || []).filter(Boolean);
      if (!docIds.length) continue;

      const firstDocId = docIds[0];
      const docDef     = docsById[firstDocId];

      seededRecords.push(makeSeedGroupRecord({
        groupId:      group.id,
        documentId:   firstDocId,
        documentName: docDef?.name || "Document",
        expirable:    !!docDef?.expirable,
        uploadedBy:   admin.id,
        daysBack:     7,
      }));
    }

    await updateRecord("client", client.id, {
      complianceGroups: selectedGroupIds,
      complianceGroup:  selectedGroupIds[0] || null,
      groupDocuments:   seededRecords,
    });
    log.ok(`Compliance groups assigned to ${client.name}`);
  }

  for (const practice of Object.values(practiceMap)) {
    const seededRecords = [];

    if (practicePrimaryGroup) {
      const docIds = (practicePrimaryGroup.documents || []).filter(Boolean);
      if (docIds.length) {
        const firstDocId = docIds[0];
        const docDef     = docsById[firstDocId];

        seededRecords.push(makeSeedGroupRecord({
          groupId:      practicePrimaryGroup.id,
          documentId:   firstDocId,
          documentName: docDef?.name || "Document",
          expirable:    !!docDef?.expirable,
          uploadedBy:   admin.id,
          daysBack:     5,
        }));
      }
    }

    await updateRecord("practice", practice.id, {
      complianceGroup: practicePrimaryGroup?.id || null,
      groupDocuments:  seededRecords,
    });
    log.ok(`Compliance group assigned to ${practice.name}`);
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  await disconnectDB();

  log.ok("\nSeed complete!");
  log.info(
    `Users: ${USERS.length} | ICBs: ${ICBS.length} | ` +
    `Federations: ${Object.keys(fedMap).length} | Clients: ${Object.keys(clientMap).length} | ` +
    `Practices: ${Object.keys(practiceMap).length} | ` +
    `Compliance Docs: ${COMPLIANCE_DOCS.length} | Document Groups: ${DOCUMENT_GROUPS.length}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  runSeed().catch(err => {
    log.error("Seed failed:", err.message);
    process.exit(1);
  });
}