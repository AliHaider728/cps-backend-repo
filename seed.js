/**
 * @file seed.js
 * @description Populates the PostgreSQL database (app_records table) with
 *              realistic demo data for all CPS entities.
 *
 * Updated (Apr 2026):
 *   - Default mode preserves existing data and inserts only missing records
 *   - Optional `--fresh` flag wipes seed models before re-seeding
 *   - Duplicate prevention uses existence checks against natural keys
 *   - Relationship records remain intact across ICB -> Federation -> Client -> Practice
 *   - Module 3: Clinician Management seed data added
 *
 * Usage:
 *   node seed.js
 *   node seed.js --fresh
 *   npm run seed
 *   npm run seed -- --fresh
 */

import dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { initDB, query, disconnectDB } from "./config/db.js";
import { createId } from "./lib/ids.js";

const log = {
  info: (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  ok: (msg, ...args) => console.log(`[OK]    ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
};

const args = process.argv.slice(2);
const FRESH_SEED = args.includes("--fresh");

if (FRESH_SEED) {
  log.warn("\n[--fresh] Destructive mode enabled");
  log.warn("Existing seed data will be deleted before re-seeding.\n");
}

/*   DB HELPERS   */
function mapRecordRow(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id, ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || row.updated_at || null,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function mergeUniqueValues(existing = [], incoming = []) {
  const values = Array.isArray(existing) ? [...existing] : [];
  for (const item of incoming || []) {
    if (!values.some((value) => sameJson(value, item))) values.push(item);
  }
  return values;
}

function mergeUniqueObjectsBy(existing = [], incoming = [], keyFn) {
  const values = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(values.map(keyFn));
  for (const item of incoming || []) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(item);
  }
  return values;
}

async function insertRecord(model, payload) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const data = { ...payload, createdAt: timestamp, updatedAt: timestamp };
  const result = await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRecordRow(result.rows[0]);
}

async function updateRecord(model, id, patch) {
  const data = { ...patch, updatedAt: new Date().toISOString() };
  const result = await query(
    `UPDATE app_records
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2
     RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRecordRow(result.rows[0]);
}

async function deleteAllByModel(model) {
  const result = await query(`DELETE FROM app_records WHERE model = $1`, [model]);
  log.info(`Cleared model "${model}" - ${result.rowCount} rows deleted`);
}

async function findRecord(model, field, value) {
  const result = await query(
    `SELECT id, data, created_at, updated_at FROM app_records
     WHERE model = $1 AND data->>$2 = $3 LIMIT 1`,
    [model, field, String(value)]
  );
  return mapRecordRow(result.rows[0]);
}

async function findRecordByFields(model, criteria) {
  const entries = Object.entries(criteria || {}).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) return null;
  const params = [model];
  const clauses = ["model = $1"];
  for (const [field, value] of entries) {
    params.push(field);
    const fieldIndex = params.length;
    params.push(String(value));
    const valueIndex = params.length;
    clauses.push(`COALESCE(data->>$${fieldIndex}, '') = $${valueIndex}`);
  }
  const result = await query(
    `SELECT id, data, created_at, updated_at FROM app_records WHERE ${clauses.join(" AND ")} LIMIT 1`,
    params
  );
  return mapRecordRow(result.rows[0]);
}

async function ensureRecord(model, payload, field, value, label) {
  const existing = await findRecord(model, field, value);
  if (existing) { log.info(`${label} already exists - keeping existing record`); return existing; }
  const created = await insertRecord(model, payload);
  log.ok(`${label} created`);
  return created;
}

async function patchRecordIfNeeded(model, currentRecord, patch, label) {
  const hasChanges = Object.entries(patch).some(([key, value]) => !sameJson(currentRecord?.[key], value));
  if (!hasChanges) { log.info(`${label} already up to date`); return currentRecord; }
  const updated = await updateRecord(model, currentRecord.id, patch);
  log.ok(`${label} updated`);
  return updated || currentRecord;
}

/*   STATIC SEED DATA   */

const USERS = [
  { name: "Super Admin",   email: "superadmin@coreprescribing.co.uk", password: "SuperAdmin@123", role: "super_admin"       },
  { name: "Sarah Director",email: "director@coreprescribing.co.uk",   password: "Director@123",   role: "director"          },
  { name: "James Ops",     email: "ops@coreprescribing.co.uk",        password: "OpsManager@123", role: "ops_manager"       },
  { name: "Fatema Finance",email: "finance@coreprescribing.co.uk",    password: "Finance@123",    role: "finance"           },
  { name: "Stacey Training",email:"training@coreprescribing.co.uk",   password: "Training@123",   role: "training"          },
  { name: "Workforce VA",  email: "workforce@coreprescribing.co.uk",  password: "Workforce@123",  role: "workforce"         },
  { name: "Dr. Ali Haider",email: "clinician@coreprescribing.co.uk",  password: "Clinician@123",  role: "clinician"         },
  { name: "Dr. Sara Malik",email: "clinician2@coreprescribing.co.uk", password: "Clinician@123",  role: "clinician"         },
];

const ICBS = [
  { name: "NHS Greater Manchester ICB",          region: "North West",           code: "QOP" },
  { name: "NHS Lancashire & South Cumbria ICB",  region: "North West",           code: "QE1" },
  { name: "NHS Cheshire & Merseyside ICB",       region: "North West",           code: "QYG" },
  { name: "NHS South Yorkshire ICB",             region: "Yorkshire & Humber",   code: "QF7" },
];

const FEDERATION_DATA = [
  { icbName: "NHS Greater Manchester ICB",         name: "Salford Together Federation",                      type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Manchester Health & Care Commissioning",           type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Stockport Together",                               type: "INT"        },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Lancashire & South Cumbria NHS Foundation Trust",  type: "federation" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Fylde Coast Medical Services",                     type: "federation" },
  { icbName: "NHS Cheshire & Merseyside ICB",      name: "Cheshire & Wirral Foundation Trust",               type: "federation" },
];

const CLIENT_DATA = [
  {
    icbName: "NHS Greater Manchester ICB", federationName: "Salford Together Federation",
    clients: [
      {
        name: "Salford Central Client", annualSpend: 280000, contractType: "ARRS",
        xeroCode: "SAL1", xeroCategory: "Client",
        contractRenewalDate: "2025-04-01", contractExpiryDate: "2026-03-31",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Key Client - 6 practices, high footfall area.",
        contacts: [
          { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordclient.nhs.uk", phone: "0161 234 5678", type: "decision_maker" },
          { name: "Kevin Walsh",      role: "Client Manager",    email: "k.walsh@salfordclient.nhs.uk",     phone: "0161 234 5679", type: "general" },
          { name: "Rachel Green",     role: "Finance Lead",      email: "r.green@salfordclient.nhs.uk",     phone: "0161 234 5680", type: "finance" },
        ],
        requiredSystems: { emis: true, ice: true, accurx: true, docman: true, vpn: true },
        tags: ["arrs", "high-priority"], priority: "high",
        decisionMakers: [{ name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordclient.nhs.uk", phone: "0161 234 5678", isPrimary: true }],
        financeContacts: [{ name: "Rachel Green", role: "Finance Lead", email: "r.green@salfordclient.nhs.uk", phone: "0161 234 5680" }],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: true, publicNotes: "Monthly review every first Tuesday.", lastUpdated: null },
        reportingArchive: [],
      },
      {
        name: "Wythenshawe & Benchill Client", annualSpend: 195000, contractType: "EA",
        xeroCode: "WYT1", xeroCategory: "Client",
        contractRenewalDate: "2025-06-01", contractExpiryDate: "2026-05-31",
        ndaSigned: true, dsaSigned: true, mouReceived: false, welcomePackSent: true,
        notes: "Growing Client, recently added 2 new practices.",
        contacts: [
          { name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythclient.nhs.uk", phone: "0161 945 1234", type: "decision_maker" },
          { name: "Sandra Lee",         role: "Ops Manager",       email: "s.lee@wythclient.nhs.uk",   phone: "0161 945 1235", type: "operations" },
        ],
        requiredSystems: { emis: true, accurx: true }, tags: ["ea"], priority: "normal",
        decisionMakers: [{ name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythclient.nhs.uk", phone: "0161 945 1234", isPrimary: true }],
        financeContacts: [],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: false, publicNotes: "", lastUpdated: null },
        reportingArchive: [],
      },
    ],
  },
  {
    icbName: "NHS Lancashire & South Cumbria ICB", federationName: "Lancashire & South Cumbria NHS Foundation Trust",
    clients: [
      {
        name: "Preston City Client", annualSpend: 142000, contractType: "Direct",
        xeroCode: "PRE1", xeroCategory: "Client",
        contractRenewalDate: "2025-10-01", contractExpiryDate: "2026-09-30",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "Urban Client - strong pharmacist engagement.",
        contacts: [
          { name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", type: "decision_maker" },
          { name: "Lucy Parker",     role: "Finance Contact",   email: "l.parker@prestoncity.nhs.uk",  phone: "01772 555 101", type: "finance" },
        ],
        requiredSystems: { systmOne: true, ice: true, accurx: true }, tags: ["direct"], priority: "normal",
        decisionMakers: [{ name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", isPrimary: true }],
        financeContacts: [{ name: "Lucy Parker", role: "Finance Contact", email: "l.parker@prestoncity.nhs.uk", phone: "01772 555 101" }],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: true, publicNotes: "", lastUpdated: null },
        reportingArchive: [],
      },
    ],
  },
  {
    icbName: "NHS Cheshire & Merseyside ICB", federationName: "Cheshire & Wirral Foundation Trust",
    clients: [
      {
        name: "Liverpool South Client", annualSpend: 220000, contractType: "ARRS",
        xeroCode: "LIV1", xeroCategory: "Client",
        contractRenewalDate: "2026-01-01", contractExpiryDate: "2026-12-31",
        ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
        notes: "High-demand urban Client.",
        contacts: [
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk", phone: "0151 233 4000", type: "decision_maker" },
          { name: "Diane Morris",    role: "Client Manager",    email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general" },
          { name: "James Wong",      role: "Finance Lead",      email: "j.wong@livsouth.nhs.uk",   phone: "0151 233 4002", type: "finance" },
        ],
        requiredSystems: { systmOne: true, accurx: true, docman: true }, tags: ["arrs", "urban"], priority: "normal",
        decisionMakers: [{ name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk", phone: "0151 233 4000", isPrimary: true }],
        financeContacts: [{ name: "James Wong", role: "Finance Lead", email: "j.wong@livsouth.nhs.uk", phone: "0151 233 4002" }],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: true, publicNotes: "", lastUpdated: null },
        reportingArchive: [],
      },
    ],
  },
];

const PRACTICE_DATA = {
  "Salford Central Client": [
    {
      name: "Pendleton Medical Centre", odsCode: "P84001",
      address: "15 Broad Street", city: "Salford", postcode: "M6 5BN",
      fte: "0.5 FTE (20HRS/WEEK)", contractType: "ARRS", xeroCode: "PEN1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      confidentialityFormSigned: true, prescribingPoliciesShared: true, remoteAccessSetup: true,
      systemAccessNotes: "EMIS Web - full access granted. ICE, AccuRx, Docman active.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485566", status: "granted" },
        { system: "ICE",    status: "granted" },
        { system: "AccuRx", status: "granted" },
        { system: "Docman", status: "granted" },
      ],
      tags: ["arrs"], priority: "normal",
      localDecisionMakers: [{ name: "Dr. James Pendleton", role: "GP Partner", email: "j.pendleton@pendletonmc.nhs.uk", phone: "0161 111 2222", isPrimary: true }],
      siteSpecificDocs: [], reportingArchive: [],
    },
    {
      name: "Weaste & Seedley Surgery", odsCode: "P84002",
      address: "42 Liverpool Street", city: "Salford", postcode: "M5 4LT",
      fte: "0.4 FTE", contractType: "ARRS", xeroCode: "WEA1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "EMIS Web - view only. ICE access requested.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485567", status: "view_only" },
        { system: "ICE", status: "requested" },
      ],
      tags: [], priority: "normal", localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
    },
  ],
  "Preston City Client": [
    {
      name: "Fishergate Hill Surgery", odsCode: "P82001",
      address: "Fishergate Hill", city: "Preston", postcode: "PR1 8JD",
      fte: "0.6 FTE", contractType: "Direct", xeroCode: "FIS1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      systemAccessNotes: "SystmOne - full access. ICE and AccuRx granted.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "ICE",      status: "granted" },
        { system: "AccuRx",   status: "granted" },
      ],
      tags: ["direct"], priority: "normal",
      localDecisionMakers: [{ name: "Dr. Helen Fisher", role: "Practice Manager", email: "h.fisher@fishergate.nhs.uk", phone: "01772 100 200", isPrimary: true }],
      siteSpecificDocs: [], reportingArchive: [],
    },
    {
      name: "Larches Surgery", odsCode: "P82002",
      address: "Blackpool Road", city: "Preston", postcode: "PR2 6AA",
      fte: "0.4 FTE", contractType: "Direct", xeroCode: "LAR1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: false, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: false, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "SystmOne - access pending setup.",
      systemAccess: [{ system: "SystmOne", status: "pending" }],
      tags: [], priority: "normal", localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
    },
  ],
  "Liverpool South Client": [
    {
      name: "Speke Medical Centre", odsCode: "P83001",
      address: "Speke Road", city: "Liverpool", postcode: "L24 2SQ",
      fte: "0.5 FTE", contractType: "ARRS", xeroCode: "SPE1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      systemAccessNotes: "SystmOne full access. AccuRx active. Docman installed.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "AccuRx",   status: "granted" },
        { system: "Docman",   status: "granted" },
      ],
      tags: ["arrs"], priority: "normal", localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
    },
  ],
};

const HISTORY_TEMPLATES = [
  { type: "meeting",       subject: "Monthly performance review",       notes: "Discussed Q1 KPIs. All targets met. Follow-up scheduled.",             outcome: "KPIs reviewed - all green. No action required.",          followUpNote: "Send Q2 report by end of month." },
  { type: "call",          subject: "Clinician placement query",         notes: "Client manager called regarding locum cover in March.",                outcome: "Cover arranged - confirmed Dr. Ali Haider for week 2.",    followUpNote: "" },
  { type: "email",         subject: "Contract renewal discussion",       notes: "Sent updated terms. Awaiting sign-off from Clinical Director.",        outcome: "Terms sent. Awaiting response.",                           followUpNote: "Chase if no reply within 5 working days." },
  { type: "complaint",     subject: "Complaint: delayed rota",           notes: "Client reported delay in March rota. Resolved same day.",              outcome: "Resolved - apology sent, rota corrected.",                 followUpNote: "" },
  { type: "note",          subject: "Internal note - billing query",     notes: "Finance contact queried invoice. Confirmed correct.",                  outcome: "Invoice confirmed correct. No changes needed.",            followUpNote: "" },
  { type: "document",      subject: "MOU signed and received",           notes: "MOU received and filed. Contract now complete.",                       outcome: "MOU filed. Contract complete.",                            followUpNote: "" },
  { type: "system_access", subject: "System access request sent",        notes: "EMIS access requested for new clinical pharmacist.",                   outcome: "Request sent - awaiting confirmation from practice.",      followUpNote: "Chase access confirmation after 3 working days." },
];

const COMPLIANCE_DOCS = [
  { name: "CV",                                                                              displayOrder: 7,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "DBS Check/Update Service",                                                        displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "Annual renewal required." },
  { name: "Declaration of Interests Form",                                                   displayOrder: 4,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)",           displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: true,  notes: "Ops uploads this on behalf of clinician." },
  { name: "East Lancashire Alliance - Enhanced Access - Key Contacts",                       displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: true,  notes: "" },
  { name: "Enhanced DBS Certificate (cert only)",                                            displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Enhanced DBS Certitifcate",                                                       displayOrder: 10, mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Fitness to Practise Form",                                                        displayOrder: 3,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Health Screening Form",                                                           displayOrder: 5,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Indemnity Insurance Certificate",                                                 displayOrder: 11, mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "Must be current at all times." },
  { name: "Proof of Address",                                                                displayOrder: 9,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference 1",                                                                     displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference 2",                                                                     displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference Contact Details",                                                       displayOrder: 12, mandatory: false, expirable: false, active: false, defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: false, notes: "Archived - no longer required." },
  { name: "Right to Work",                                                                   displayOrder: 8,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Right to Work Check (expired)",                                                   displayOrder: 5,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Confidentiality Statement",                                                displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Data Protection Statement",                                                displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Non-Disclosure Agreement",                                                 displayOrder: 6,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
];

const DOCUMENT_GROUPS = [
  { name: "Archive/Expired",              displayOrder: 0, active: false, docNames: ["Right to Work", "Indemnity Insurance Certificate"], applicableContractTypes: [], colour: "#9ca3af", notes: "Archived group - do not assign to new clinicians." },
  { name: "Clinical Staff Documents",     displayOrder: 1, active: true,  docNames: ["CV", "DBS Check/Update Service", "Declaration of Interests Form", "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", "East Lancashire Alliance - Enhanced Access - Key Contacts", "Fitness to Practise Form", "Health Screening Form", "Reference 1", "Reference 2", "Reference Contact Details", "Signed Confidentiality Statement", "Signed Data Protection Statement", "Signed Non-Disclosure Agreement"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#3b82f6", notes: "Standard compliance group for all clinical staff." },
  { name: "DBS and Update",               displayOrder: 0, active: true,  docNames: ["DBS Check/Update Service", "Enhanced DBS Certificate (cert only)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#f59e0b", notes: "For clinicians using DBS Update Service." },
  { name: "DBS cert - no update",         displayOrder: 0, active: true,  docNames: ["Enhanced DBS Certificate (cert only)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#f97316", notes: "For clinicians with standalone DBS certificate only." },
  { name: "Enhanced Access",              displayOrder: 0, active: true,  docNames: ["Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", "East Lancashire Alliance - Enhanced Access - Key Contacts"], applicableContractTypes: ["EA"], colour: "#8b5cf6", notes: "Enhanced Access contract clinicians only." },
  { name: "Non-Clinical Staff",           displayOrder: 0, active: true,  docNames: ["CV", "Signed Confidentiality Statement", "Signed Data Protection Statement", "Reference 1", "Reference 2", "Proof of Address"], applicableContractTypes: [], colour: "#10b981", notes: "For admin, VA, and non-clinical roles." },
  { name: "Right to Work Check (Expired)",displayOrder: 0, active: true,  docNames: ["Right to Work Check (expired)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#ef4444", notes: "Assign when right to work needs re-verification." },
];

const daysAgo     = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

const makeSeedGroupRecord = ({ groupId, documentId, documentName, expirable, uploadedBy, daysBack = 10 }) => {
  const uploadedAt = daysAgo(daysBack);
  const expiryDate = expirable ? new Date(Date.now() + 180 * 86_400_000).toISOString() : null;
  const upload = {
    uploadId: createId(),
    fileName: `${String(documentName || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`,
    fileUrl: `https://files.cps.local/${groupId}/${documentId}/${Date.now()}.pdf`,
    mimeType: "application/pdf",
    fileSize: 180000 + Math.floor(Math.random() * 70000),
    status: "uploaded", uploadedAt, expiryDate, renewalDate: null,
    notes: "Seeded upload record",
    reference: `SEED-${String(documentId).slice(-6).toUpperCase()}`,
    uploadedBy,
  };
  return {
    group: groupId, document: documentId, fileName: upload.fileName,
    fileUrl: upload.fileUrl, mimeType: upload.mimeType, fileSize: upload.fileSize,
    status: upload.status, uploadedAt: upload.uploadedAt, expiryDate: upload.expiryDate,
    renewalDate: null, notes: upload.notes, uploadedBy, lastUpdatedBy: uploadedBy, uploads: [upload],
  };
};

/*   RUN SEED   */

export async function runSeed() {
  await initDB();
  log.ok("PostgreSQL connected");

  try {
    if (FRESH_SEED) {
      log.info("\nWiping existing data (--fresh mode)...");
      await deleteAllByModel("contact_history");
      await deleteAllByModel("practice");
      await deleteAllByModel("client");
      await deleteAllByModel("pcn");
      await deleteAllByModel("federation");
      await deleteAllByModel("icb");
      await deleteAllByModel("document_group");
      await deleteAllByModel("compliance_document");
      await deleteAllByModel("user");
      // Module 3
      await deleteAllByModel("ClinicianClientHistory");
      await deleteAllByModel("ClinicianSupervisionLog");
      await deleteAllByModel("ClinicianLeaveEntry");
      await deleteAllByModel("ClinicianComplianceDoc");
      await deleteAllByModel("Clinician");
      log.ok("Fresh wipe complete");
    } else {
      log.info("\nSafe mode enabled - existing data will not be deleted");
      log.info("Only missing records will be inserted\n");
    }

    /* ── Users ────────────────────────────────────────────── */
    log.info("Seeding Users...");
    const seededUsers = [];
    for (const userDef of USERS) {
      const email = userDef.email.trim().toLowerCase();
      const existing = await findRecord("user", "email", email);
      if (existing) { log.info(`${email} [${userDef.role}] already exists - skipped`); seededUsers.push(existing); continue; }
      const hashed = await bcrypt.hash(userDef.password, 12);
      const user = await insertRecord("user", {
        name: userDef.name, email, password: hashed, role: userDef.role,
        isActive: true, mustChangePassword: false, isAnonymised: false, lastLogin: null, phone: "",
        department: userDef.role === "clinician" ? "Clinical" : userDef.role === "finance" ? "Finance" : userDef.role === "training" ? "Training" : "Operations",
        jobTitle: userDef.role === "clinician" ? "Clinical Pharmacist" : userDef.role === "finance" ? "Finance Manager" : "",
        opsLead: null, supervisor: null, startDate: daysAgo(180), leaveDate: null,
        profilePhoto: "", emergencyContact: { name: "", relationship: "", phone: "", email: "" },
      });
      seededUsers.push(user);
      log.ok(`${email} [${userDef.role}] created`);
    }

    const admin     = seededUsers.find((u) => u.role === "super_admin");
    const clinicians = seededUsers.filter((u) => u.role === "clinician");
    if (!admin) throw new Error("Super admin seed record could not be resolved");

    /* ── ICBs ─────────────────────────────────────────────── */
    log.info("\nSeeding ICBs...");
    const icbMap = {};
    for (const data of ICBS) {
      icbMap[data.name] = await ensureRecord("icb", { ...data, createdBy: admin.id }, "code", data.code, data.name);
    }

    /* ── Federations ──────────────────────────────────────── */
    log.info("\nSeeding Federations...");
    const fedMap = {};
    for (const data of FEDERATION_DATA) {
      const icb = icbMap[data.icbName];
      if (!icb) { log.warn(`ICB not found: ${data.icbName}`); continue; }
      fedMap[data.name] = await ensureRecord(
        "federation", { name: data.name, icb: icb.id, type: data.type, createdBy: admin.id },
        "name", data.name, `${data.name} [${data.type}]`
      );
    }

    /* ── Clients ──────────────────────────────────────────── */
    log.info("\nSeeding Clients...");
    const clientMap = {};
    for (const group of CLIENT_DATA) {
      const icb        = icbMap[group.icbName];
      const federation = fedMap[group.federationName];
      if (!icb) { log.warn(`ICB not found: ${group.icbName}`); continue; }
      for (const data of group.clients) {
        const payload = {
          ...data,
          icb: { _id: icb.id, id: icb.id, name: icb.name, code: icb.code },
          federation: federation ? { _id: federation.id, id: federation.id, name: federation.name, type: federation.type } : null,
          federationName: group.federationName,
          restrictedClinicians: clinicians.length ? [clinicians[0].id] : [],
          createdBy: admin.id,
        };
        clientMap[data.name] = await ensureRecord("client", payload, "xeroCode", data.xeroCode, data.name);
      }
    }

    /* ── Practices ────────────────────────────────────────── */
    log.info("\nSeeding Practices...");
    const practiceMap = {};
    for (const [clientName, practices] of Object.entries(PRACTICE_DATA)) {
      const client = clientMap[clientName];
      if (!client) { log.warn(`Client not found: ${clientName}`); continue; }
      for (const data of practices) {
        practiceMap[data.name] = await ensureRecord(
          "practice",
          { ...data, client: { _id: client.id, id: client.id, name: client.name }, linkedClinicians: clinicians.map((c) => c.id), createdBy: admin.id },
          "odsCode", data.odsCode, data.name
        );
      }
    }

    /* ── Contact History ──────────────────────────────────── */
    log.info("\nSeeding Contact History...");
    for (const client of Object.values(clientMap)) {
      for (let i = 0; i < 5; i++) {
        const t = HISTORY_TEMPLATES[i];
        const existing = await findRecordByFields("contact_history", { entityType: "Client", entityId: client.id, type: t.type, subject: t.subject });
        if (existing) { log.info(`Contact history for ${client.name}: ${t.subject} already exists - skipped`); continue; }
        await insertRecord("contact_history", { entityType: "Client", entityId: client.id, type: t.type, subject: t.subject, notes: t.notes, date: daysAgo((i + 1) * 7), time: ["09:00","10:30","11:00","14:00","15:30"][i] || "10:00", starred: i === 0, createdBy: admin.id, outcome: t.outcome || "", followUpDate: t.followUpNote ? daysFromNow(7 + i) : null, followUpNote: t.followUpNote || "" });
        log.ok(`Contact history created for ${client.name}: ${t.subject}`);
      }
    }
    for (const practice of Object.values(practiceMap)) {
      for (let i = 0; i < 3; i++) {
        const t = HISTORY_TEMPLATES[i];
        const existing = await findRecordByFields("contact_history", { entityType: "Practice", entityId: practice.id, type: t.type, subject: t.subject });
        if (existing) { log.info(`Contact history for ${practice.name}: ${t.subject} already exists - skipped`); continue; }
        await insertRecord("contact_history", { entityType: "Practice", entityId: practice.id, type: t.type, subject: t.subject, notes: t.notes, date: daysAgo((i + 1) * 5), time: "10:00", starred: false, createdBy: admin.id, outcome: t.outcome || "", followUpDate: null, followUpNote: "" });
        log.ok(`Contact history created for ${practice.name}: ${t.subject}`);
      }
    }
    log.ok("Contact history seeding complete");

    /* ── Compliance Documents ─────────────────────────────── */
    log.info("\nSeeding Compliance Documents...");
    const docMap = {};
    for (const data of COMPLIANCE_DOCS) {
      docMap[data.name] = await ensureRecord("compliance_document", { ...data, createdBy: admin.id }, "name", data.name, data.name);
    }

    /* ── Document Groups ──────────────────────────────────── */
    log.info("\nSeeding Document Groups...");
    const groupMap = {};
    for (const group of DOCUMENT_GROUPS) {
      const docIds = group.docNames.map((name) => docMap[name]?.id).filter(Boolean);
      groupMap[group.name] = await ensureRecord(
        "document_group",
        { name: group.name, displayOrder: group.displayOrder, active: group.active, documents: docIds, applicableContractTypes: group.applicableContractTypes || [], colour: group.colour || "", notes: group.notes || "", createdBy: admin.id },
        "name", group.name, `${group.name} (${docIds.length} docs)`
      );
    }

    /* ── Assign Compliance Groups ─────────────────────────── */
    log.info("\nAssigning compliance groups...");
    const docsById           = Object.fromEntries(Object.values(docMap).map((d) => [d.id, d]));
    const clientPrimaryGroup  = groupMap["Clinical Staff Documents"];
    const clientSecondaryGroup= groupMap["DBS and Update"];
    const practicePrimaryGroup= groupMap["Non-Clinical Staff"] || clientPrimaryGroup || null;

    for (const [clientName, client] of Object.entries(clientMap)) {
      const selectedGroups   = [clientPrimaryGroup, clientSecondaryGroup].filter(Boolean);
      const selectedGroupIds = selectedGroups.map((g) => g.id);
      const seededRecords    = [];
      for (const group of selectedGroups) {
        const docIds = (group.documents || []).filter(Boolean);
        if (!docIds.length) continue;
        const firstDocId = docIds[0];
        const docDef     = docsById[firstDocId];
        seededRecords.push(makeSeedGroupRecord({ groupId: group.id, documentId: firstDocId, documentName: docDef?.name || "Document", expirable: !!docDef?.expirable, uploadedBy: admin.id, daysBack: 7 }));
      }
      clientMap[clientName] = await patchRecordIfNeeded("client", client, {
        complianceGroups: mergeUniqueValues(client.complianceGroups, selectedGroupIds),
        complianceGroup:  client.complianceGroup || selectedGroupIds[0] || null,
        groupDocuments:   mergeUniqueObjectsBy(client.groupDocuments, seededRecords, (item) => `${item.group}:${item.document}`),
      }, `Compliance groups for ${client.name}`);
    }

    for (const [practiceName, practice] of Object.entries(practiceMap)) {
      const seededRecords = [];
      if (practicePrimaryGroup) {
        const docIds = (practicePrimaryGroup.documents || []).filter(Boolean);
        if (docIds.length) {
          const firstDocId = docIds[0];
          const docDef     = docsById[firstDocId];
          seededRecords.push(makeSeedGroupRecord({ groupId: practicePrimaryGroup.id, documentId: firstDocId, documentName: docDef?.name || "Document", expirable: !!docDef?.expirable, uploadedBy: admin.id, daysBack: 5 }));
        }
      }
      practiceMap[practiceName] = await patchRecordIfNeeded("practice", practice, {
        complianceGroup: practice.complianceGroup || practicePrimaryGroup?.id || null,
        groupDocuments:  mergeUniqueObjectsBy(practice.groupDocuments, seededRecords, (item) => `${item.group}:${item.document}`),
      }, `Compliance group for ${practiceName}`);
    }

    /* ═══════════════════════════════════════════════════════
       MODULE 3 — CLINICIAN MANAGEMENT
    ═══════════════════════════════════════════════════════ */

    log.info("\nSeeding Clinicians (Module 3)...");

    const opsUser      = seededUsers.find((u) => u.role === "ops_manager");
    const trainingUser = seededUsers.find((u) => u.role === "training");
    const clin1User    = seededUsers.find((u) => u.email === "clinician@coreprescribing.co.uk");
    const clin2User    = seededUsers.find((u) => u.email === "clinician2@coreprescribing.co.uk");

    const salfordClient   = clientMap["Salford Central Client"];
    const prestonClient   = clientMap["Preston City Client"];
    const liverpoolClient = clientMap["Liverpool South Client"];
    const pendletonPrac   = practiceMap["Pendleton Medical Centre"];
    const fishergateP     = practiceMap["Fishergate Hill Surgery"];
    const spekePrac       = practiceMap["Speke Medical Centre"];

    const CLINICIAN_SEED = [
      {
        fullName: "Dr. Ali Haider", clinicianType: "Pharmacist",
        gphcNumber: "2087654", smartCard: "SC-AH-001",
        phone: "07712 345678", email: "clinician@coreprescribing.co.uk",
        addressLine1: "12 Oak Avenue", city: "Salford", postcode: "M6 7AB",
        contractType: "ARRS", noticePeriod: "1 month", workingHours: 20, startDate: daysAgo(180),
        user: clin1User?.id || null, opsLead: opsUser?.id || null, supervisor: admin.id,
        specialisms: ["Diabetes", "Hypertension"], futurePotential: "Strong candidate for PCN lead role",
        scopeWorkstreams: ["SMR", "EHCH"], shadowingAvailable: true, systemsInUse: ["EMIS", "AccuRx", "ICE"],
        emergencyContacts: [{ name: "Fatima Haider", relationship: "Spouse", phone: "07712 999888", email: "fatima@example.com" }],
        onboarding: { welcomePackSent: true, welcomePackSentAt: daysAgo(170), welcomePackSentBy: admin.id, mobilisationPlan: true, systemsRequested: true, smartcardOrdered: true, contractSigned: true, indemnityVerified: true, inductionBooked: true, notes: "" },
        cppeStatus: { enrolled: true, exempt: false, completed: false, enrolledAt: daysAgo(120), completedAt: null, progressPct: 65, modules: [{ name: "Clinical Assessment", status: "completed", completedAt: daysAgo(90) }, { name: "Medicines Optimisation", status: "completed", completedAt: daysAgo(60) }, { name: "Prescribing Practice", status: "in_progress", completedAt: null }], notes: "On track for completion" },
        isRestricted: false, restrictReason: "", isActive: true, notes: "Key ARRS pharmacist, high performer.", createdBy: admin.id,
      },
      {
        fullName: "Sarah Thompson", clinicianType: "Technician",
        gphcNumber: "3091234", smartCard: "SC-ST-002",
        phone: "07823 456789", email: "clinician2@coreprescribing.co.uk",
        addressLine1: "45 Church Street", city: "Preston", postcode: "PR1 3EF",
        contractType: "EA", noticePeriod: "2 weeks", workingHours: 16, startDate: daysAgo(120),
        user: clin2User?.id || null, opsLead: opsUser?.id || null, supervisor: admin.id,
        specialisms: ["COPD/Asthma", "QOF"], futurePotential: "Potential for enhanced access lead",
        scopeWorkstreams: ["Enhanced Access", "QOF Reviews"], shadowingAvailable: false, systemsInUse: ["SystmOne", "AccuRx"],
        emergencyContacts: [{ name: "John Thompson", relationship: "Partner", phone: "07823 111222", email: "john@example.com" }],
        onboarding: { welcomePackSent: true, welcomePackSentAt: daysAgo(115), welcomePackSentBy: admin.id, mobilisationPlan: true, systemsRequested: true, smartcardOrdered: true, contractSigned: true, indemnityVerified: true, inductionBooked: false, notes: "Induction pending" },
        cppeStatus: { enrolled: true, exempt: false, completed: false, enrolledAt: daysAgo(90), completedAt: null, progressPct: 30, modules: [{ name: "Clinical Assessment", status: "completed", completedAt: daysAgo(60) }, { name: "Medicines Optimisation", status: "not_started", completedAt: null }, { name: "Prescribing Practice", status: "not_started", completedAt: null }], notes: "Needs support with module 2" },
        isRestricted: false, restrictReason: "", isActive: true, notes: "EA technician, punctual and reliable.", createdBy: admin.id,
      },
      {
        fullName: "Dr. Rania Aziz", clinicianType: "IP",
        gphcNumber: "4056789", smartCard: "SC-RA-003",
        phone: "07934 567890", email: "rania.aziz@coreprescribing.co.uk",
        addressLine1: "8 Maple Road", city: "Liverpool", postcode: "L24 8QR",
        contractType: "Direct", noticePeriod: "1 month", workingHours: 30, startDate: daysAgo(90),
        user: null, opsLead: opsUser?.id || null, supervisor: trainingUser?.id || admin.id,
        specialisms: ["Hypertension", "Diabetes", "QOF"], futurePotential: "Senior IP, suitable for clinical lead",
        scopeWorkstreams: ["SMR", "EHCH", "Care Homes"], shadowingAvailable: true, systemsInUse: ["SystmOne", "ICE", "AccuRx", "Docman"],
        emergencyContacts: [{ name: "Tariq Aziz", relationship: "Brother", phone: "07934 000111", email: "tariq@example.com" }],
        onboarding: { welcomePackSent: true, welcomePackSentAt: daysAgo(85), welcomePackSentBy: admin.id, mobilisationPlan: true, systemsRequested: true, smartcardOrdered: true, contractSigned: true, indemnityVerified: true, inductionBooked: true, notes: "" },
        cppeStatus: { enrolled: false, exempt: true, completed: false, enrolledAt: null, completedAt: null, progressPct: 0, modules: [], notes: "Exempt — already holds independent prescriber qualification" },
        isRestricted: false, restrictReason: "", isActive: true, notes: "Highly experienced IP. Direct contract.", createdBy: admin.id,
      },
    ];

    const clinicianMap = {};
    for (const data of CLINICIAN_SEED) {
      const existing = await findRecord("Clinician", "email", data.email);
      if (existing) { log.info(`Clinician ${data.fullName} already exists - skipped`); clinicianMap[data.fullName] = existing; continue; }
      clinicianMap[data.fullName] = await insertRecord("Clinician", data);
      log.ok(`Clinician created: ${data.fullName} [${data.clinicianType} / ${data.contractType}]`);
    }

    const [clin1, clin2, clin3] = Object.values(clinicianMap);

    /* ── Clinician Compliance Docs ────────────────────────── */
    log.info("\nSeeding Clinician Compliance Docs...");
    const CLINICIAN_COMPLIANCE_SEED = [
      { clinician: clin1?.id, docName: "DBS Check/Update Service",       status: "approved", mandatory: true,  expiryDate: daysFromNow(200), uploadedBy: "clinician", uploadedAt: daysAgo(160), approvedBy: admin.id, approvedAt: daysAgo(155), notes: "" },
      { clinician: clin1?.id, docName: "Indemnity Insurance Certificate", status: "approved", mandatory: true,  expiryDate: daysFromNow(180), uploadedBy: "clinician", uploadedAt: daysAgo(150), approvedBy: admin.id, approvedAt: daysAgo(145), notes: "" },
      { clinician: clin1?.id, docName: "CV",                              status: "approved", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(170), approvedBy: admin.id, approvedAt: daysAgo(165), notes: "" },
      { clinician: clin1?.id, docName: "Right to Work",                   status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
      { clinician: clin2?.id, docName: "DBS Check/Update Service",        status: "uploaded", mandatory: true,  expiryDate: daysFromNow(300), uploadedBy: "clinician", uploadedAt: daysAgo(30),  approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin2?.id, docName: "CV",                              status: "approved", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(110), approvedBy: admin.id, approvedAt: daysAgo(105), notes: "" },
      { clinician: clin2?.id, docName: "Indemnity Insurance Certificate",  status: "expired",  mandatory: true,  expiryDate: daysAgo(10),      uploadedBy: "clinician", uploadedAt: daysAgo(375), approvedBy: admin.id, approvedAt: daysAgo(370), notes: "Renewal required urgently" },
      { clinician: clin3?.id, docName: "CV",                              status: "approved", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(80),  approvedBy: admin.id, approvedAt: daysAgo(75),  notes: "" },
      { clinician: clin3?.id, docName: "Indemnity Insurance Certificate",  status: "approved", mandatory: true,  expiryDate: daysFromNow(240), uploadedBy: "clinician", uploadedAt: daysAgo(85),  approvedBy: admin.id, approvedAt: daysAgo(80),  notes: "" },
      { clinician: clin3?.id, docName: "Right to Work",                   status: "approved", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(88),  approvedBy: admin.id, approvedAt: daysAgo(83),  notes: "" },
      { clinician: clin3?.id, docName: "Signed Non-Disclosure Agreement",  status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
    ];

    for (const doc of CLINICIAN_COMPLIANCE_SEED) {
      if (!doc.clinician) { log.warn("Skipping compliance doc - clinician not found"); continue; }
      const existing = await findRecordByFields("ClinicianComplianceDoc", { clinician: doc.clinician, docName: doc.docName });
      if (existing) { log.info(`Compliance doc "${doc.docName}" already exists - skipped`); continue; }
      await insertRecord("ClinicianComplianceDoc", { ...doc, createdBy: admin.id });
      log.ok(`Compliance doc: ${doc.docName} [${doc.status}]`);
    }

    /* ── Leave Entries ────────────────────────────────────── */
    log.info("\nSeeding Clinician Leave Entries...");
    const LEAVE_SEED = [
      { clinician: clin1?.id, leaveType: "annual", contract: "ARRS",   startDate: daysAgo(60), endDate: daysAgo(55), days: 5,   approved: true,  approvedBy: admin.id, approvedAt: daysAgo(70),  notes: "Summer leave",   createdBy: admin.id },
      { clinician: clin1?.id, leaveType: "sick",   contract: "ARRS",   startDate: daysAgo(30), endDate: daysAgo(29), days: 1,   approved: true,  approvedBy: admin.id, approvedAt: daysAgo(29),  notes: "Flu",            createdBy: admin.id },
      { clinician: clin2?.id, leaveType: "annual", contract: "EA",     startDate: daysAgo(45), endDate: daysAgo(42), days: 3,   approved: true,  approvedBy: admin.id, approvedAt: daysAgo(50),  notes: "Family holiday", createdBy: admin.id },
      { clinician: clin2?.id, leaveType: "cppe",   contract: "EA",     startDate: daysAgo(15), endDate: daysAgo(14), days: 1,   approved: true,  approvedBy: admin.id, approvedAt: daysAgo(20),  notes: "CPPE study day", createdBy: admin.id },
      { clinician: clin3?.id, leaveType: "annual", contract: "Direct", startDate: daysAgo(20), endDate: daysAgo(16), days: 4,   approved: true,  approvedBy: admin.id, approvedAt: daysAgo(25),  notes: "Annual leave",   createdBy: admin.id },
      { clinician: clin3?.id, leaveType: "other",  contract: "Direct", startDate: daysAgo(5),  endDate: daysAgo(5),  days: 0.5, approved: false, approvedBy: null,     approvedAt: null,         notes: "Appointment AM", createdBy: admin.id },
    ];

    for (const entry of LEAVE_SEED) {
      if (!entry.clinician) { log.warn("Skipping leave entry - clinician not found"); continue; }
      const existing = await findRecordByFields("ClinicianLeaveEntry", { clinician: entry.clinician, leaveType: entry.leaveType, startDate: entry.startDate });
      if (existing) { log.info(`Leave entry already exists - skipped`); continue; }
      await insertRecord("ClinicianLeaveEntry", entry);
      log.ok(`Leave entry: ${entry.leaveType} / ${entry.contract} / ${entry.days} days`);
    }

    /* ── Supervision Logs ─────────────────────────────────── */
    log.info("\nSeeding Clinician Supervision Logs...");
    const SUPERVISION_SEED = [
      { clinician: clin1?.id, sessionDate: daysAgo(30), ragStatus: "green", supervisor: admin.id,                     notes: "Good progress. All targets met. No concerns.",               actionItems: [],                                                                     createdBy: admin.id },
      { clinician: clin1?.id, sessionDate: daysAgo(60), ragStatus: "amber", supervisor: admin.id,                     notes: "Minor documentation delays. Improvement plan discussed.",     actionItems: [{ text: "Submit outstanding notes", dueDate: daysAgo(50), done: true }], createdBy: admin.id },
      { clinician: clin2?.id, sessionDate: daysAgo(25), ragStatus: "green", supervisor: admin.id,                     notes: "Performing well in EA sessions. Patient feedback positive.",   actionItems: [],                                                                     createdBy: admin.id },
      { clinician: clin2?.id, sessionDate: daysAgo(55), ragStatus: "red",   supervisor: admin.id,                     notes: "Missed two EA shifts without notice. Formal warning issued.",  actionItems: [{ text: "Attend HR meeting", dueDate: daysAgo(45), done: true }],      createdBy: admin.id },
      { clinician: clin3?.id, sessionDate: daysAgo(14), ragStatus: "green", supervisor: trainingUser?.id || admin.id, notes: "Excellent prescribing record. No issues.",                    actionItems: [],                                                                     createdBy: admin.id },
      { clinician: clin3?.id, sessionDate: daysAgo(45), ragStatus: "green", supervisor: trainingUser?.id || admin.id, notes: "Care home reviews on track. Caseload manageable.",            actionItems: [],                                                                     createdBy: admin.id },
    ];

    for (const entry of SUPERVISION_SEED) {
      if (!entry.clinician) { log.warn("Skipping supervision log - clinician not found"); continue; }
      const existing = await findRecordByFields("ClinicianSupervisionLog", { clinician: entry.clinician, sessionDate: entry.sessionDate });
      if (existing) { log.info(`Supervision log already exists - skipped`); continue; }
      await insertRecord("ClinicianSupervisionLog", entry);
      log.ok(`Supervision log: ${entry.ragStatus.toUpperCase()} — ${entry.sessionDate}`);
    }

    /* ── Client History ───────────────────────────────────── */
    log.info("\nSeeding Clinician Client History...");
    const CLIENT_HISTORY_SEED = [
      {
        clinician: clin1?.id, pcn: salfordClient?.id || null, practice: pendletonPrac?.id || null,
        contract: "ARRS", startDate: daysAgo(180), endDate: null, status: "active",
        systemAccess: [
          { system: "EMIS",   status: "granted", requestedAt: daysAgo(178), grantedAt: daysAgo(175) },
          { system: "AccuRx", status: "granted", requestedAt: daysAgo(178), grantedAt: daysAgo(176) },
          { system: "ICE",    status: "granted", requestedAt: daysAgo(178), grantedAt: daysAgo(177) },
        ],
        isRestricted: false, restrictReason: "", createdBy: admin.id,
      },
      {
        clinician: clin2?.id, pcn: prestonClient?.id || null, practice: fishergateP?.id || null,
        contract: "EA", startDate: daysAgo(120), endDate: null, status: "active",
        systemAccess: [
          { system: "SystmOne", status: "granted", requestedAt: daysAgo(118), grantedAt: daysAgo(115) },
          { system: "AccuRx",   status: "granted", requestedAt: daysAgo(118), grantedAt: daysAgo(116) },
        ],
        isRestricted: false, restrictReason: "", createdBy: admin.id,
      },
      {
        clinician: clin3?.id, pcn: liverpoolClient?.id || null, practice: spekePrac?.id || null,
        contract: "Direct", startDate: daysAgo(90), endDate: null, status: "active",
        systemAccess: [
          { system: "SystmOne", status: "granted", requestedAt: daysAgo(88), grantedAt: daysAgo(85) },
          { system: "ICE",      status: "granted", requestedAt: daysAgo(88), grantedAt: daysAgo(86) },
          { system: "Docman",   status: "pending", requestedAt: daysAgo(10), grantedAt: null },
        ],
        isRestricted: false, restrictReason: "", createdBy: admin.id,
      },
    ];

    for (const entry of CLIENT_HISTORY_SEED) {
      if (!entry.clinician) { log.warn("Skipping client history - clinician not found"); continue; }
      const existing = await findRecordByFields("ClinicianClientHistory", { clinician: entry.clinician, contract: entry.contract, startDate: entry.startDate });
      if (existing) { log.info(`Client history already exists - skipped`); continue; }
      await insertRecord("ClinicianClientHistory", entry);
      log.ok(`Client history: ${entry.contract} — status: ${entry.status}`);
    }

    /* ═══════════════════════════════════════════════════════
       END MODULE 3
    ═══════════════════════════════════════════════════════ */

    log.ok("\nSeed complete!");
    log.info(
      `Users: ${USERS.length} | ICBs: ${ICBS.length} | ` +
      `Federations: ${Object.keys(fedMap).length} | Clients: ${Object.keys(clientMap).length} | ` +
      `Practices: ${Object.keys(practiceMap).length} | ` +
      `Compliance Docs: ${COMPLIANCE_DOCS.length} | Document Groups: ${DOCUMENT_GROUPS.length} | ` +
      `Clinicians: ${Object.keys(clinicianMap).length} | ` +
      `Clinician Compliance Docs: ${CLINICIAN_COMPLIANCE_SEED.length} | ` +
      `Leave Entries: ${LEAVE_SEED.length} | ` +
      `Supervision Logs: ${SUPERVISION_SEED.length} | ` +
      `Client History: ${CLIENT_HISTORY_SEED.length}`
    );
    log.info(`Mode: ${FRESH_SEED ? "DESTRUCTIVE (--fresh)" : "SAFE (no deletions)"}`);
  } finally {
    await disconnectDB();
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  runSeed().catch((err) => {
    log.error("Seed failed:", err.message);
    process.exit(1);
  });
}