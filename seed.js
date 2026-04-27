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

/* DB helpers */
function mapRecordRow(row) {
  if (!row) return null;

  return {
    _id: row.id,
    id: row.id,
    ...(row.data || {}),
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
    if (!values.some((value) => sameJson(value, item))) {
      values.push(item);
    }
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
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE model = $1 AND data->>$2 = $3
     LIMIT 1`,
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
    `SELECT id, data, created_at, updated_at
     FROM app_records
     WHERE ${clauses.join(" AND ")}
     LIMIT 1`,
    params
  );

  return mapRecordRow(result.rows[0]);
}

async function ensureRecord(model, payload, field, value, label) {
  const existing = await findRecord(model, field, value);
  if (existing) {
    log.info(`${label} already exists - keeping existing record`);
    return existing;
  }

  const created = await insertRecord(model, payload);
  log.ok(`${label} created`);
  return created;
}

async function patchRecordIfNeeded(model, currentRecord, patch, label) {
  const hasChanges = Object.entries(patch).some(([key, value]) => !sameJson(currentRecord?.[key], value));
  if (!hasChanges) {
    log.info(`${label} already up to date`);
    return currentRecord;
  }

  const updated = await updateRecord(model, currentRecord.id, patch);
  log.ok(`${label} updated`);
  return updated || currentRecord;
}

/* Seed data */

const USERS = [
  { name: "Super Admin", email: "superadmin@coreprescribing.co.uk", password: "SuperAdmin@123", role: "super_admin" },
  { name: "Sarah Director", email: "director@coreprescribing.co.uk", password: "Director@123", role: "director" },
  { name: "James Ops", email: "ops@coreprescribing.co.uk", password: "OpsManager@123", role: "ops_manager" },
  { name: "Fatema Finance", email: "finance@coreprescribing.co.uk", password: "Finance@123", role: "finance" },
  { name: "Stacey Training", email: "training@coreprescribing.co.uk", password: "Training@123", role: "training" },
  { name: "Workforce VA", email: "workforce@coreprescribing.co.uk", password: "Workforce@123", role: "workforce" },
  { name: "Dr. Ali Haider", email: "clinician@coreprescribing.co.uk", password: "Clinician@123", role: "clinician" },
  { name: "Dr. Sara Malik", email: "clinician2@coreprescribing.co.uk", password: "Clinician@123", role: "clinician" },
];

const ICBS = [
  { name: "NHS Greater Manchester ICB", region: "North West", code: "QOP" },
  { name: "NHS Lancashire & South Cumbria ICB", region: "North West", code: "QE1" },
  { name: "NHS Cheshire & Merseyside ICB", region: "North West", code: "QYG" },
  { name: "NHS South Yorkshire ICB", region: "Yorkshire & Humber", code: "QF7" },
];

const FEDERATION_DATA = [
  { icbName: "NHS Greater Manchester ICB", name: "Salford Together Federation", type: "federation" },
  { icbName: "NHS Greater Manchester ICB", name: "Manchester Health & Care Commissioning", type: "federation" },
  { icbName: "NHS Greater Manchester ICB", name: "Stockport Together", type: "INT" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Lancashire & South Cumbria NHS Foundation Trust", type: "federation" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Fylde Coast Medical Services", type: "federation" },
  { icbName: "NHS Cheshire & Merseyside ICB", name: "Cheshire & Wirral Foundation Trust", type: "federation" },
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
        notes: "Key Client - 6 practices, high footfall area.",
        contacts: [
          { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordclient.nhs.uk", phone: "0161 234 5678", type: "decision_maker" },
          { name: "Kevin Walsh", role: "Client Manager", email: "k.walsh@salfordclient.nhs.uk", phone: "0161 234 5679", type: "general" },
          { name: "Rachel Green", role: "Finance Lead", email: "r.green@salfordclient.nhs.uk", phone: "0161 234 5680", type: "finance" },
        ],
        requiredSystems: { emis: true, ice: true, accurx: true, docman: true, vpn: true },
        tags: ["arrs", "high-priority"],
        priority: "high",
        decisionMakers: [
          { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordclient.nhs.uk", phone: "0161 234 5678", isPrimary: true },
        ],
        financeContacts: [
          { name: "Rachel Green", role: "Finance Lead", email: "r.green@salfordclient.nhs.uk", phone: "0161 234 5680" },
        ],
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
          { name: "Sandra Lee", role: "Ops Manager", email: "s.lee@wythclient.nhs.uk", phone: "0161 945 1235", type: "operations" },
        ],
        requiredSystems: { emis: true, accurx: true },
        tags: ["ea"],
        priority: "normal",
        decisionMakers: [
          { name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythclient.nhs.uk", phone: "0161 945 1234", isPrimary: true },
        ],
        financeContacts: [],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: false, publicNotes: "", lastUpdated: null },
        reportingArchive: [],
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
        notes: "Urban Client - strong pharmacist engagement.",
        contacts: [
          { name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", type: "decision_maker" },
          { name: "Lucy Parker", role: "Finance Contact", email: "l.parker@prestoncity.nhs.uk", phone: "01772 555 101", type: "finance" },
        ],
        requiredSystems: { systmOne: true, ice: true, accurx: true },
        tags: ["direct"],
        priority: "normal",
        decisionMakers: [
          { name: "Dr. Tom Brennan", role: "Clinical Director", email: "t.brennan@prestoncity.nhs.uk", phone: "01772 555 100", isPrimary: true },
        ],
        financeContacts: [
          { name: "Lucy Parker", role: "Finance Contact", email: "l.parker@prestoncity.nhs.uk", phone: "01772 555 101" },
        ],
        clientFacingData: { showMonthlyMeetings: true, showClinicianMeetings: true, publicNotes: "", lastUpdated: null },
        reportingArchive: [],
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
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk", phone: "0151 233 4000", type: "decision_maker" },
          { name: "Diane Morris", role: "Client Manager", email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general" },
          { name: "James Wong", role: "Finance Lead", email: "j.wong@livsouth.nhs.uk", phone: "0151 233 4002", type: "finance" },
        ],
        requiredSystems: { systmOne: true, accurx: true, docman: true },
        tags: ["arrs", "urban"],
        priority: "normal",
        decisionMakers: [
          { name: "Dr. Aarav Patel", role: "Clinical Director", email: "a.patel@livsouth.nhs.uk", phone: "0151 233 4000", isPrimary: true },
        ],
        financeContacts: [
          { name: "James Wong", role: "Finance Lead", email: "j.wong@livsouth.nhs.uk", phone: "0151 233 4002" },
        ],
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
      fte: "0.5 FTE (20HRS/WEEK)", contractType: "ARRS",
      xeroCode: "PEN1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: true, reportsImported: true,
      confidentialityFormSigned: true, prescribingPoliciesShared: true, remoteAccessSetup: true,
      systemAccessNotes: "EMIS Web - full access granted. ICE, AccuRx, Docman active.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485566", status: "granted" },
        { system: "ICE", status: "granted" },
        { system: "AccuRx", status: "granted" },
        { system: "Docman", status: "granted" },
      ],
      tags: ["arrs"], priority: "normal",
      localDecisionMakers: [
        { name: "Dr. James Pendleton", role: "GP Partner", email: "j.pendleton@pendletonmc.nhs.uk", phone: "0161 111 2222", isPrimary: true },
      ],
      siteSpecificDocs: [], reportingArchive: [],
    },
    {
      name: "Weaste & Seedley Surgery", odsCode: "P84002",
      address: "42 Liverpool Street", city: "Salford", postcode: "M5 4LT",
      fte: "0.4 FTE", contractType: "ARRS",
      xeroCode: "WEA1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: true, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: true, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "EMIS Web - view only. ICE access requested.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485567", status: "view_only" },
        { system: "ICE", status: "requested" },
      ],
      tags: [], priority: "normal",
      localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
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
      systemAccessNotes: "SystmOne - full access. ICE and AccuRx granted.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "ICE", status: "granted" },
        { system: "AccuRx", status: "granted" },
      ],
      tags: ["direct"], priority: "normal",
      localDecisionMakers: [
        { name: "Dr. Helen Fisher", role: "Practice Manager", email: "h.fisher@fishergate.nhs.uk", phone: "01772 100 200", isPrimary: true },
      ],
      siteSpecificDocs: [], reportingArchive: [],
    },
    {
      name: "Larches Surgery", odsCode: "P82002",
      address: "Blackpool Road", city: "Preston", postcode: "PR2 6AA",
      fte: "0.4 FTE", contractType: "Direct",
      xeroCode: "LAR1", xeroCategory: "GPX",
      ndaSigned: true, dsaSigned: false, mouReceived: true, welcomePackSent: true,
      mobilisationPlanSent: false, templateInstalled: false, reportsImported: false,
      systemAccessNotes: "SystmOne - access pending setup.",
      systemAccess: [{ system: "SystmOne", status: "pending" }],
      tags: [], priority: "normal",
      localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
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
        { system: "AccuRx", status: "granted" },
        { system: "Docman", status: "granted" },
      ],
      tags: ["arrs"], priority: "normal",
      localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
    },
  ],
};

const HISTORY_TEMPLATES = [
  { type: "meeting", subject: "Monthly performance review", notes: "Discussed Q1 KPIs. All targets met. Follow-up scheduled.", outcome: "KPIs reviewed - all green. No action required.", followUpNote: "Send Q2 report by end of month." },
  { type: "call", subject: "Clinician placement query", notes: "Client manager called regarding locum cover in March.", outcome: "Cover arranged - confirmed Dr. Ali Haider for week 2.", followUpNote: "" },
  { type: "email", subject: "Contract renewal discussion", notes: "Sent updated terms. Awaiting sign-off from Clinical Director.", outcome: "Terms sent. Awaiting response.", followUpNote: "Chase if no reply within 5 working days." },
  { type: "complaint", subject: "Complaint: delayed rota", notes: "Client reported delay in March rota. Resolved same day.", outcome: "Resolved - apology sent, rota corrected.", followUpNote: "" },
  { type: "note", subject: "Internal note - billing query", notes: "Finance contact queried invoice. Confirmed correct.", outcome: "Invoice confirmed correct. No changes needed.", followUpNote: "" },
  { type: "document", subject: "MOU signed and received", notes: "MOU received and filed. Contract now complete.", outcome: "MOU filed. Contract complete.", followUpNote: "" },
  { type: "system_access", subject: "System access request sent", notes: "EMIS access requested for new clinical pharmacist.", outcome: "Request sent - awaiting confirmation from practice.", followUpNote: "Chase access confirmation after 3 working days." },
];

const COMPLIANCE_DOCS = [
  { name: "CV", displayOrder: 7, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "DBS Check/Update Service", displayOrder: 2, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true, visibleToClinician: true, notes: "Annual renewal required." },
  { name: "Declaration of Interests Form", displayOrder: 4, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", displayOrder: 0, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: false, visibleToClinician: true, notes: "Ops uploads this on behalf of clinician." },
  { name: "East Lancashire Alliance - Enhanced Access - Key Contacts", displayOrder: 0, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: false, visibleToClinician: true, notes: "" },
  { name: "Enhanced DBS Certificate (cert only)", displayOrder: 2, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Enhanced DBS Certitifcate", displayOrder: 10, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Fitness to Practise Form", displayOrder: 3, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Health Screening Form", displayOrder: 5, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Indemnity Insurance Certificate", displayOrder: 11, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true, visibleToClinician: true, notes: "Must be current at all times." },
  { name: "Proof of Address", displayOrder: 9, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Reference 1", displayOrder: 1, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Reference 2", displayOrder: 2, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Reference Contact Details", displayOrder: 12, mandatory: false, expirable: false, active: false, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: false, visibleToClinician: false, notes: "Archived - no longer required." },
  { name: "Right to Work", displayOrder: 8, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Right to Work Check (expired)", displayOrder: 5, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Signed Confidentiality Statement", displayOrder: 2, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Signed Data Protection Statement", displayOrder: 1, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
  { name: "Signed Non-Disclosure Agreement", displayOrder: 6, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0, clinicianCanUpload: true, visibleToClinician: true, notes: "" },
];

const DOCUMENT_GROUPS = [
  { name: "Archive/Expired", displayOrder: 0, active: false, docNames: ["Right to Work", "Indemnity Insurance Certificate"], applicableContractTypes: [], colour: "#9ca3af", notes: "Archived group - do not assign to new clinicians." },
  { name: "Clinical Staff Documents", displayOrder: 1, active: true, docNames: ["CV", "DBS Check/Update Service", "Declaration of Interests Form", "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", "East Lancashire Alliance - Enhanced Access - Key Contacts", "Fitness to Practise Form", "Health Screening Form", "Reference 1", "Reference 2", "Reference Contact Details", "Signed Confidentiality Statement", "Signed Data Protection Statement", "Signed Non-Disclosure Agreement"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#3b82f6", notes: "Standard compliance group for all clinical staff." },
  { name: "DBS and Update", displayOrder: 0, active: true, docNames: ["DBS Check/Update Service", "Enhanced DBS Certificate (cert only)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#f59e0b", notes: "For clinicians using DBS Update Service." },
  { name: "DBS cert - no update", displayOrder: 0, active: true, docNames: ["Enhanced DBS Certificate (cert only)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#f97316", notes: "For clinicians with standalone DBS certificate only." },
  { name: "Enhanced Access", displayOrder: 0, active: true, docNames: ["Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", "East Lancashire Alliance - Enhanced Access - Key Contacts"], applicableContractTypes: ["EA"], colour: "#8b5cf6", notes: "Enhanced Access contract clinicians only." },
  { name: "Non-Clinical Staff", displayOrder: 0, active: true, docNames: ["CV", "Signed Confidentiality Statement", "Signed Data Protection Statement", "Reference 1", "Reference 2", "Proof of Address"], applicableContractTypes: [], colour: "#10b981", notes: "For admin, VA, and non-clinical roles." },
  { name: "Right to Work Check (Expired)", displayOrder: 0, active: true, docNames: ["Right to Work Check (expired)"], applicableContractTypes: ["ARRS", "EA", "Direct"], colour: "#ef4444", notes: "Assign when right to work needs re-verification." },
];

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
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
      log.ok("Fresh wipe complete");
    } else {
      log.info("\nSafe mode enabled - existing data will not be deleted");
      log.info("Only missing records will be inserted\n");
    }

    log.info("Seeding Users...");
    const seededUsers = [];
    for (const userDef of USERS) {
      const email = userDef.email.trim().toLowerCase();
      const existing = await findRecord("user", "email", email);
      if (existing) {
        log.info(`${email} [${userDef.role}] already exists - skipped`);
        seededUsers.push(existing);
        continue;
      }

      const hashed = await bcrypt.hash(userDef.password, 12);
      const user = await insertRecord("user", {
        name: userDef.name,
        email,
        password: hashed,
        role: userDef.role,
        isActive: true,
        mustChangePassword: false,
        isAnonymised: false,
        lastLogin: null,
        phone: "",
        department: userDef.role === "clinician" ? "Clinical" : userDef.role === "finance" ? "Finance" : userDef.role === "training" ? "Training" : "Operations",
        jobTitle: userDef.role === "clinician" ? "Clinical Pharmacist" : userDef.role === "finance" ? "Finance Manager" : "",
        opsLead: null,
        supervisor: null,
        startDate: daysAgo(180),
        leaveDate: null,
        profilePhoto: "",
        emergencyContact: { name: "", relationship: "", phone: "", email: "" },
      });
      seededUsers.push(user);
      log.ok(`${email} [${userDef.role}] created`);
    }

    const admin = seededUsers.find((user) => user.role === "super_admin");
    const clinicians = seededUsers.filter((user) => user.role === "clinician");
    if (!admin) {
      throw new Error("Super admin seed record could not be resolved");
    }

    log.info("\nSeeding ICBs...");
    const icbMap = {};
    for (const data of ICBS) {
      const record = await ensureRecord("icb", { ...data, createdBy: admin.id }, "code", data.code, data.name);
      icbMap[data.name] = record;
    }

    log.info("\nSeeding Federations...");
    const fedMap = {};
    for (const data of FEDERATION_DATA) {
      const icb = icbMap[data.icbName];
      if (!icb) {
        log.warn(`ICB not found: ${data.icbName}`);
        continue;
      }

      const record = await ensureRecord(
        "federation",
        { name: data.name, icb: icb.id, type: data.type, createdBy: admin.id },
        "name",
        data.name,
        `${data.name} [${data.type}]`
      );
      fedMap[data.name] = record;
    }

    log.info("\nSeeding Clients...");
    const clientMap = {};
    for (const group of CLIENT_DATA) {
      const icb = icbMap[group.icbName];
      const federation = fedMap[group.federationName];

      if (!icb) {
        log.warn(`ICB not found: ${group.icbName}`);
        continue;
      }

      for (const data of group.clients) {
        const payload = {
          ...data,
          icb: { _id: icb.id, id: icb.id, name: icb.name, code: icb.code },
          federation: federation ? { _id: federation.id, id: federation.id, name: federation.name, type: federation.type } : null,
          federationName: group.federationName,
          restrictedClinicians: clinicians.length ? [clinicians[0].id] : [],
          createdBy: admin.id,
        };

        const record = await ensureRecord("client", payload, "xeroCode", data.xeroCode, data.name);
        clientMap[data.name] = record;
      }
    }

    log.info("\nSeeding Practices...");
    const practiceMap = {};
    for (const [clientName, practices] of Object.entries(PRACTICE_DATA)) {
      const client = clientMap[clientName];
      if (!client) {
        log.warn(`Client not found: ${clientName}`);
        continue;
      }

      for (const data of practices) {
        const payload = {
          ...data,
          client: { _id: client.id, id: client.id, name: client.name },
          linkedClinicians: clinicians.map((clinician) => clinician.id),
          createdBy: admin.id,
        };

        const record = await ensureRecord("practice", payload, "odsCode", data.odsCode, data.name);
        practiceMap[data.name] = record;
      }
    }

    log.info("\nSeeding Contact History...");
    for (const client of Object.values(clientMap)) {
      for (let i = 0; i < 5; i += 1) {
        const template = HISTORY_TEMPLATES[i];
        const existing = await findRecordByFields("contact_history", {
          entityType: "Client",
          entityId: client.id,
          type: template.type,
          subject: template.subject,
        });

        if (existing) {
          log.info(`Contact history for ${client.name}: ${template.subject} already exists - skipped`);
          continue;
        }

        await insertRecord("contact_history", {
          entityType: "Client",
          entityId: client.id,
          type: template.type,
          subject: template.subject,
          notes: template.notes,
          date: daysAgo((i + 1) * 7),
          time: ["09:00", "10:30", "11:00", "14:00", "15:30"][i] || "10:00",
          starred: i === 0,
          createdBy: admin.id,
          outcome: template.outcome || "",
          followUpDate: template.followUpNote ? daysFromNow(7 + i) : null,
          followUpNote: template.followUpNote || "",
        });
        log.ok(`Contact history created for ${client.name}: ${template.subject}`);
      }
    }

    for (const practice of Object.values(practiceMap)) {
      for (let i = 0; i < 3; i += 1) {
        const template = HISTORY_TEMPLATES[i];
        const existing = await findRecordByFields("contact_history", {
          entityType: "Practice",
          entityId: practice.id,
          type: template.type,
          subject: template.subject,
        });

        if (existing) {
          log.info(`Contact history for ${practice.name}: ${template.subject} already exists - skipped`);
          continue;
        }

        await insertRecord("contact_history", {
          entityType: "Practice",
          entityId: practice.id,
          type: template.type,
          subject: template.subject,
          notes: template.notes,
          date: daysAgo((i + 1) * 5),
          time: "10:00",
          starred: false,
          createdBy: admin.id,
          outcome: template.outcome || "",
          followUpDate: null,
          followUpNote: "",
        });
        log.ok(`Contact history created for ${practice.name}: ${template.subject}`);
      }
    }
    log.ok("Contact history seeding complete");

    log.info("\nSeeding Compliance Documents...");
    const docMap = {};
    for (const data of COMPLIANCE_DOCS) {
      const record = await ensureRecord("compliance_document", { ...data, createdBy: admin.id }, "name", data.name, data.name);
      docMap[data.name] = record;
    }

    log.info("\nSeeding Document Groups...");
    const groupMap = {};
    for (const group of DOCUMENT_GROUPS) {
      const docIds = group.docNames.map((name) => docMap[name]?.id).filter(Boolean);
      const record = await ensureRecord(
        "document_group",
        {
          name: group.name,
          displayOrder: group.displayOrder,
          active: group.active,
          documents: docIds,
          applicableContractTypes: group.applicableContractTypes || [],
          colour: group.colour || "",
          notes: group.notes || "",
          createdBy: admin.id,
        },
        "name",
        group.name,
        `${group.name} (${docIds.length} docs)`
      );
      groupMap[group.name] = record;
    }

    log.info("\nAssigning compliance groups...");
    const docsById = Object.fromEntries(Object.values(docMap).map((doc) => [doc.id, doc]));
    const clientPrimaryGroup = groupMap["Clinical Staff Documents"];
    const clientSecondaryGroup = groupMap["DBS and Update"];
    const practicePrimaryGroup = groupMap["Non-Clinical Staff"] || clientPrimaryGroup || null;

    for (const [clientName, client] of Object.entries(clientMap)) {
      const selectedGroups = [clientPrimaryGroup, clientSecondaryGroup].filter(Boolean);
      const selectedGroupIds = selectedGroups.map((group) => group.id);
      const seededRecords = [];

      for (const group of selectedGroups) {
        const docIds = (group.documents || []).filter(Boolean);
        if (!docIds.length) continue;

        const firstDocId = docIds[0];
        const docDef = docsById[firstDocId];
        seededRecords.push(
          makeSeedGroupRecord({
            groupId: group.id,
            documentId: firstDocId,
            documentName: docDef?.name || "Document",
            expirable: !!docDef?.expirable,
            uploadedBy: admin.id,
            daysBack: 7,
          })
        );
      }

      clientMap[clientName] = await patchRecordIfNeeded(
        "client",
        client,
        {
          complianceGroups: mergeUniqueValues(client.complianceGroups, selectedGroupIds),
          complianceGroup: client.complianceGroup || selectedGroupIds[0] || null,
          groupDocuments: mergeUniqueObjectsBy(
            client.groupDocuments,
            seededRecords,
            (item) => `${item.group}:${item.document}`
          ),
        },
        `Compliance groups for ${client.name}`
      );
    }

    for (const [practiceName, practice] of Object.entries(practiceMap)) {
      const seededRecords = [];

      if (practicePrimaryGroup) {
        const docIds = (practicePrimaryGroup.documents || []).filter(Boolean);
        if (docIds.length) {
          const firstDocId = docIds[0];
          const docDef = docsById[firstDocId];
          seededRecords.push(
            makeSeedGroupRecord({
              groupId: practicePrimaryGroup.id,
              documentId: firstDocId,
              documentName: docDef?.name || "Document",
              expirable: !!docDef?.expirable,
              uploadedBy: admin.id,
              daysBack: 5,
            })
          );
        }
      }

      practiceMap[practiceName] = await patchRecordIfNeeded(
        "practice",
        practice,
        {
          complianceGroup: practice.complianceGroup || practicePrimaryGroup?.id || null,
          groupDocuments: mergeUniqueObjectsBy(
            practice.groupDocuments,
            seededRecords,
            (item) => `${item.group}:${item.document}`
          ),
        },
        `Compliance group for ${practice.name}`
      );
    }

    log.ok("\nSeed complete!");
    log.info(
      `Users: ${USERS.length} | ICBs: ${ICBS.length} | ` +
      `Federations: ${Object.keys(fedMap).length} | Clients: ${Object.keys(clientMap).length} | ` +
      `Practices: ${Object.keys(practiceMap).length} | ` +
      `Compliance Docs: ${COMPLIANCE_DOCS.length} | Document Groups: ${DOCUMENT_GROUPS.length}`
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
