/**
 * @file seed.js
 * @description Populates the PostgreSQL database (app_records table) with
 *              realistic demo data for all CPS entities.
 *
 * UPDATED (Apr 2026):
 *   COMPLIANCE_DOCS       — +clinicianCanUpload, +visibleToClinician, +defaultReminderDays, +notes
 *   DOCUMENT_GROUPS       — +applicableContractTypes, +colour, +notes
 *   CLIENT_DATA (Clients) — +decisionMakers, +financeContacts, +tags, +priority, +clientFacingData
 *   PRACTICE_DATA         — +localDecisionMakers, +tags, +priority
 *   ContactHistory        — +outcome, +followUpDate, +followUpNote
 *
 *   FIXED: Model name corrected back to "PCN" (was accidentally changed to "client").
 *          Practice field corrected back to "pcn" reference.
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

const log = {
  info:  (msg, ...a) => console.log(`[INFO]  ${msg}`, ...a),
  ok:    (msg, ...a) => console.log(`[OK]    ${msg}`, ...a),
  warn:  (msg, ...a) => console.warn(`[WARN]  ${msg}`, ...a),
  error: (msg, ...a) => console.error(`[ERROR] ${msg}`, ...a),
};

/* ── DB helpers  */
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
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2`,
    [model, id, JSON.stringify(data)]
  );
}

async function deleteAllByModel(model) {
  const result = await query(`DELETE FROM app_records WHERE model = $1`, [model]);
  log.info(`Cleared model "${model}" — ${result.rowCount} rows deleted`);
}

/* ══════════════════════════════════════════════════════════════════
   SEED DATA
══════════════════════════════════════════════════════════════════ */

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
  { icbName: "NHS Greater Manchester ICB",         name: "Salford Together Federation",                     type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Manchester Health & Care Commissioning",          type: "federation" },
  { icbName: "NHS Greater Manchester ICB",         name: "Stockport Together",                              type: "INT"        },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Lancashire & South Cumbria NHS Foundation Trust", type: "federation" },
  { icbName: "NHS Lancashire & South Cumbria ICB", name: "Fylde Coast Medical Services",                   type: "federation" },
  { icbName: "NHS Cheshire & Merseyside ICB",      name: "Cheshire & Wirral Foundation Trust",             type: "federation" },
];

//  FIX: renamed CLIENT_DATA back to PCN_DATA for clarity — stored as "PCN" model
const PCN_DATA = [
  {
    icbName:        "NHS Greater Manchester ICB",
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
          { name: "Kevin Walsh",      role: "Client Manager",    email: "k.walsh@salfordclient.nhs.uk",      phone: "0161 234 5679", type: "general"        },
          { name: "Rachel Green",     role: "Finance Lead",      email: "r.green@salfordclient.nhs.uk",      phone: "0161 234 5680", type: "finance"        },
        ],
        requiredSystems: { emis: true, ice: true, accurx: true, docman: true, vpn: true },
        tags:     ["arrs", "high-priority"],
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
          { name: "Sandra Lee",         role: "Ops Manager",       email: "s.lee@wythclient.nhs.uk",   phone: "0161 945 1235", type: "operations"     },
        ],
        requiredSystems: { emis: true, accurx: true },
        tags:     ["ea"],
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
    icbName:        "NHS Lancashire & South Cumbria ICB",
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
        tags:     ["direct"],
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
    icbName:        "NHS Cheshire & Merseyside ICB",
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
          { name: "Diane Morris",    role: "Client Manager",    email: "d.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general"        },
          { name: "James Wong",      role: "Finance Lead",      email: "j.wong@livsouth.nhs.uk",   phone: "0151 233 4002", type: "finance"        },
        ],
        requiredSystems: { systmOne: true, accurx: true, docman: true },
        tags:     ["arrs", "urban"],
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

//  FIX: practice data key names unchanged — but pcn field will be used (not client)
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
      systemAccessNotes: "EMIS Web — view only. ICE access requested.",
      systemAccess: [
        { system: "EMIS", code: "EMIS/1485567", status: "view_only" },
        { system: "ICE",  status: "requested" },
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
      systemAccessNotes: "SystmOne — full access. ICE and AccuRx granted.",
      systemAccess: [
        { system: "SystmOne", status: "granted" },
        { system: "ICE",      status: "granted" },
        { system: "AccuRx",   status: "granted" },
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
      systemAccessNotes: "SystmOne — access pending setup.",
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
        { system: "AccuRx",   status: "granted" },
        { system: "Docman",   status: "granted" },
      ],
      tags: ["arrs"], priority: "normal",
      localDecisionMakers: [], siteSpecificDocs: [], reportingArchive: [],
    },
  ],
};

const HISTORY_TEMPLATES = [
  { type: "meeting",       subject: "Monthly performance review",       notes: "Discussed Q1 KPIs. All targets met. Follow-up scheduled.",          outcome: "KPIs reviewed — all green. No action required.",             followUpNote: "Send Q2 report by end of month." },
  { type: "call",          subject: "Clinician placement query",         notes: "Client manager called regarding locum cover in March.",              outcome: "Cover arranged — confirmed Dr. Ali Haider for week 2.",      followUpNote: "" },
  { type: "email",         subject: "Contract renewal discussion",       notes: "Sent updated terms. Awaiting sign-off from Clinical Director.",      outcome: "Terms sent. Awaiting response.",                             followUpNote: "Chase if no reply within 5 working days." },
  { type: "complaint",     subject: "Complaint: delayed rota",           notes: "Client reported delay in March rota. Resolved same day.",            outcome: "Resolved — apology sent, rota corrected.",                   followUpNote: "" },
  { type: "note",          subject: "Internal note — billing query",     notes: "Finance contact queried invoice. Confirmed correct.",                outcome: "Invoice confirmed correct. No changes needed.",              followUpNote: "" },
  { type: "document",      subject: "MOU signed and received",           notes: "MOU received and filed. Contract now complete.",                     outcome: "MOU filed. Contract complete.",                              followUpNote: "" },
  { type: "system_access", subject: "System access request sent",        notes: "EMIS access requested for new clinical pharmacist.",                 outcome: "Request sent — awaiting confirmation from practice.",        followUpNote: "Chase access confirmation after 3 working days." },
];

const COMPLIANCE_DOCS = [
  { name: "CV",                                                                    displayOrder: 7,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "DBS Check/Update Service",                                              displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "Annual renewal required." },
  { name: "Declaration of Interests Form",                                         displayOrder: 4,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)", displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: true,  notes: "Ops uploads this on behalf of clinician." },
  { name: "East Lancashire Alliance - Enhanced Access - Key Contacts",             displayOrder: 0,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: true,  notes: "" },
  { name: "Enhanced DBS Certificate (cert only)",                                  displayOrder: 2,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Enhanced DBS Certitifcate",                                             displayOrder: 10, mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Fitness to Practise Form",                                              displayOrder: 3,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Health Screening Form",                                                 displayOrder: 5,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Indemnity Insurance Certificate",                                       displayOrder: 11, mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "Must be current at all times." },
  { name: "Proof of Address",                                                      displayOrder: 9,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference 1",                                                           displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference 2",                                                           displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Reference Contact Details",                                             displayOrder: 12, mandatory: false, expirable: false, active: false, defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: false, visibleToClinician: false, notes: "Archived — no longer required." },
  { name: "Right to Work",                                                         displayOrder: 8,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Right to Work Check (expired)",                                         displayOrder: 5,  mandatory: true,  expirable: true,  active: true,  defaultExpiryDays: 365, defaultReminderDays: 28, clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Confidentiality Statement",                                      displayOrder: 2,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Data Protection Statement",                                      displayOrder: 1,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
  { name: "Signed Non-Disclosure Agreement",                                       displayOrder: 6,  mandatory: true,  expirable: false, active: true,  defaultExpiryDays: 0,   defaultReminderDays: 0,  clinicianCanUpload: true,  visibleToClinician: true,  notes: "" },
];

const DOCUMENT_GROUPS = [
  { name: "Archive/Expired",               displayOrder: 0, active: false, docNames: ["Right to Work", "Indemnity Insurance Certificate"],                                                                                                                                                                                                                                                                                     applicableContractTypes: [],                    colour: "#9ca3af", notes: "Archived group — do not assign to new clinicians." },
  { name: "Clinical Staff Documents",      displayOrder: 1, active: true,  docNames: ["CV","DBS Check/Update Service","Declaration of Interests Form","Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)","East Lancashire Alliance - Enhanced Access - Key Contacts","Fitness to Practise Form","Health Screening Form","Reference 1","Reference 2","Reference Contact Details","Signed Confidentiality Statement","Signed Data Protection Statement","Signed Non-Disclosure Agreement"], applicableContractTypes: ["ARRS","EA","Direct"], colour: "#3b82f6", notes: "Standard compliance group for all clinical staff." },
  { name: "DBS and Update",                displayOrder: 0, active: true,  docNames: ["DBS Check/Update Service","Enhanced DBS Certificate (cert only)"],                                                                                                                                                                                                                                                                        applicableContractTypes: ["ARRS","EA","Direct"], colour: "#f59e0b", notes: "For clinicians using DBS Update Service." },
  { name: "DBS cert - no update",          displayOrder: 0, active: true,  docNames: ["Enhanced DBS Certificate (cert only)"],                                                                                                                                                                                                                                                                                                   applicableContractTypes: ["ARRS","EA","Direct"], colour: "#f97316", notes: "For clinicians with standalone DBS certificate only." },
  { name: "Enhanced Access",               displayOrder: 0, active: true,  docNames: ["Enhanced Access - Key Contacts (Mon-Fri 6:30pm-8pm - Sat 8am-6:30pm)","East Lancashire Alliance - Enhanced Access - Key Contacts"],                                                                                                                                                                                                       applicableContractTypes: ["EA"],                 colour: "#8b5cf6", notes: "Enhanced Access contract clinicians only." },
  { name: "Non-Clinical Staff",            displayOrder: 0, active: true,  docNames: ["CV","Signed Confidentiality Statement","Signed Data Protection Statement","Reference 1","Reference 2","Proof of Address"],                                                                                                                                                                                                                applicableContractTypes: [],                    colour: "#10b981", notes: "For admin, VA, and non-clinical roles." },
  { name: "Right to Work Check (Expired)", displayOrder: 0, active: true,  docNames: ["Right to Work Check (expired)"],                                                                                                                                                                                                                                                                                                          applicableContractTypes: ["ARRS","EA","Direct"], colour: "#ef4444", notes: "Assign when right to work needs re-verification." },
];

const rand        = arr => arr[Math.floor(Math.random() * arr.length)];
const daysAgo     = n   => new Date(Date.now() - n * 86_400_000).toISOString();
const daysFromNow = n   => new Date(Date.now() + n * 86_400_000).toISOString();

const makeSeedGroupRecord = ({ groupId, documentId, documentName, expirable, uploadedBy, daysBack = 10 }) => {
  const uploadedAt = daysAgo(daysBack);
  const expiryDate = expirable ? new Date(Date.now() + 180 * 86_400_000).toISOString() : null;
  const upload = {
    uploadId: createId(),
    fileName: `${String(documentName || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`,
    fileUrl:  `https://files.cps.local/${groupId}/${documentId}/${Date.now()}.pdf`,
    mimeType: "application/pdf",
    fileSize: 180000 + Math.floor(Math.random() * 70000),
    status: "uploaded", uploadedAt, expiryDate, renewalDate: null,
    notes: "Seeded upload record",
    reference: `SEED-${String(documentId).slice(-6).toUpperCase()}`,
    uploadedBy,
  };
  return {
    group: groupId, document: documentId,
    fileName: upload.fileName, fileUrl: upload.fileUrl,
    mimeType: upload.mimeType, fileSize: upload.fileSize,
    status: upload.status, uploadedAt: upload.uploadedAt,
    expiryDate: upload.expiryDate, renewalDate: null,
    notes: upload.notes, uploadedBy, lastUpdatedBy: uploadedBy,
    uploads: [upload],
  };
};

/* ══════════════════════════════════════════════════════════════════
   MAIN SEED FUNCTION
══════════════════════════════════════════════════════════════════ */
export async function runSeed() {
  await initDB();
  log.ok("PostgreSQL connected");

  // ══════════════════════════════════════════════════════════════
  //   STEP 0 — WIPE ALL MODELS BEFORE RE-SEEDING
  // ══════════════════════════════════════════════════════════════
  log.info("\nWiping existing data...");
  await deleteAllByModel("contact_history");
  await deleteAllByModel("practice");
  //  FIX: wipe both old names to ensure clean slate
  await deleteAllByModel("PCN");
  await deleteAllByModel("pcn");
  await deleteAllByModel("client");   // wipe in case old seed ran with wrong name
  await deleteAllByModel("federation");
  await deleteAllByModel("icb");
  await deleteAllByModel("document_group");
  await deleteAllByModel("compliance_document");
  await deleteAllByModel("user");
  log.ok("Wipe complete — inserting fresh data");

  // ── 1. Users ──
  log.info("\nSeeding Users...");
  const seededUsers = [];
  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 12);
    const user   = await insertRecord("user", {
      name:               u.name,
      email:              u.email.trim().toLowerCase(),
      password:           hashed,
      role:               u.role,
      isActive:           true,
      mustChangePassword: false,
      isAnonymised:       false,
      lastLogin:          null,
      phone:        "",
      department:   u.role === "clinician" ? "Clinical" : u.role === "finance" ? "Finance" : u.role === "training" ? "Training" : "Operations",
      jobTitle:     u.role === "clinician" ? "Clinical Pharmacist" : u.role === "finance" ? "Finance Manager" : "",
      opsLead: null, supervisor: null,
      startDate:    daysAgo(180),
      leaveDate:    null,
      profilePhoto: "",
      emergencyContact: { name: "", relationship: "", phone: "", email: "" },
    });
    seededUsers.push(user);
    log.ok(`${u.email} [${u.role}]`);
  }

  const admin      = seededUsers.find(u => u.role === "super_admin");
  const clinicians = seededUsers.filter(u => u.role === "clinician");

  // ── 2. ICBs 
  log.info("\nSeeding ICBs...");
  const icbMap = {};
  for (const d of ICBS) {
    const icb = await insertRecord("icb", { ...d, createdBy: admin.id });
    icbMap[d.name] = icb;
    log.ok(d.name);
  }

  // ── 3. Federations ──
  log.info("\nSeeding Federations...");
  const fedMap = {};
  for (const d of FEDERATION_DATA) {
    const icb = icbMap[d.icbName];
    if (!icb) { log.warn(`ICB not found: ${d.icbName}`); continue; }
    const fed = await insertRecord("federation", { name: d.name, icb: icb.id, type: d.type, createdBy: admin.id });
    fedMap[d.name] = fed;
    log.ok(`${d.name} [${d.type}]`);
  }

  // ── 4. PCNs (stored as "PCN" model — display label is "Client") ──
  log.info("\nSeeding PCNs (Clients)...");
  const pcnMap = {};
  for (const group of PCN_DATA) {
    const icb = icbMap[group.icbName];
    const fed = fedMap[group.federationName];
    if (!icb) { log.warn(`ICB not found: ${group.icbName}`); continue; }
    for (const d of group.clients) {
      //  FIX: model is "PCN" — this is what PCN model/controller queries
      const pcn = await insertRecord("PCN", {
        ...d,
        icb:        { _id: icb.id, id: icb.id, name: icb.name, code: icb.code },
        federation: fed ? { _id: fed.id, id: fed.id, name: fed.name, type: fed.type } : null,
        federationName:       group.federationName,
        restrictedClinicians: clinicians.length ? [clinicians[0].id] : [],
        isActive:             true,
        createdBy:            admin.id,
      });
      pcnMap[d.name] = pcn;
      log.ok(d.name);
    }
  }

  // ── 5. Practices ─
  log.info("\nSeeding Practices...");
  const practiceMap = {};
  for (const [pcnName, practices] of Object.entries(PRACTICE_DATA)) {
    const pcn = pcnMap[pcnName];
    if (!pcn) { log.warn(`PCN not found: ${pcnName}`); continue; }
    for (const d of practices) {
      //  FIX: use "pcn" field (not "client") — this matches getPractices populate("pcn")
      const practice = await insertRecord("practice", {
        ...d,
        // "pcn" is the reference field used by the controller
        pcn:              pcn.id,
        // Keep enriched object for display (some queries use this directly)
        pcnData:          { _id: pcn.id, id: pcn.id, name: pcn.name },
        linkedClinicians: clinicians.map(c => c.id),
        isActive:         true,
        createdBy:        admin.id,
      });
      practiceMap[d.name] = practice;
      log.ok(d.name);
    }
  }

  // ── 6. Contact History ─
  log.info("\nSeeding Contact History...");
  for (const pcn of Object.values(pcnMap)) {
    for (let i = 0; i < 5; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await insertRecord("contact_history", {
        entityType:   "PCN",
        entityId:     pcn.id,
        type:         t.type,
        subject:      t.subject,
        notes:        t.notes,
        date:         daysAgo(Math.floor(Math.random() * 90)),
        time:         `${String(Math.floor(Math.random() * 8) + 9).padStart(2, "0")}:${Math.random() > 0.5 ? "00" : "30"}`,
        starred:      i === 0,
        createdBy:    admin.id,
        outcome:      t.outcome || "",
        followUpDate: t.followUpNote ? daysFromNow(7) : null,
        followUpNote: t.followUpNote || "",
      });
    }
    log.ok(`History seeded for ${pcn.name}`);
  }
  for (const practice of Object.values(practiceMap)) {
    for (let i = 0; i < 3; i++) {
      const t = rand(HISTORY_TEMPLATES);
      await insertRecord("contact_history", {
        entityType: "Practice", entityId: practice.id,
        type: t.type, subject: t.subject, notes: t.notes,
        date: daysAgo(Math.floor(Math.random() * 60)), time: "10:00",
        starred: false, createdBy: admin.id,
        outcome: t.outcome || "", followUpDate: null, followUpNote: "",
      });
    }
  }
  log.ok("Practice history seeded");

  // ── 7. Compliance Documents ──
  log.info("\nSeeding Compliance Documents...");
  const docMap = {};
  for (const d of COMPLIANCE_DOCS) {
    const doc = await insertRecord("compliance_document", { ...d, createdBy: admin.id });
    docMap[d.name] = doc;
    log.ok(d.name);
  }

  // ── 8. Document Groups ─
  log.info("\nSeeding Document Groups...");
  const groupMap = {};
  for (const g of DOCUMENT_GROUPS) {
    const docIds = g.docNames.map(n => docMap[n]?.id).filter(Boolean);
    const group  = await insertRecord("document_group", {
      name: g.name, displayOrder: g.displayOrder, active: g.active,
      documents: docIds,
      applicableContractTypes: g.applicableContractTypes || [],
      colour:   g.colour || "",
      notes:    g.notes  || "",
      createdBy: admin.id,
    });
    groupMap[g.name] = group;
    log.ok(`${g.name} (${docIds.length} docs)`);
  }

  // ── 9. Assign Compliance Groups ─
  log.info("\nAssigning compliance groups...");
  const docsById             = Object.fromEntries(Object.values(docMap).map(d => [d.id, d]));
  const pcnPrimaryGroup      = groupMap["Clinical Staff Documents"];
  const pcnSecondaryGroup    = groupMap["DBS and Update"];
  const practicePrimaryGroup = groupMap["Non-Clinical Staff"] || pcnPrimaryGroup || null;

  for (const pcn of Object.values(pcnMap)) {
    const selectedGroups   = [pcnPrimaryGroup, pcnSecondaryGroup].filter(Boolean);
    const selectedGroupIds = selectedGroups.map(g => g.id);
    const seededRecords    = [];
    for (const group of selectedGroups) {
      const docIds = (group.documents || []).filter(Boolean);
      if (!docIds.length) continue;
      const firstDocId = docIds[0];
      const docDef     = docsById[firstDocId];
      seededRecords.push(makeSeedGroupRecord({
        groupId: group.id, documentId: firstDocId,
        documentName: docDef?.name || "Document",
        expirable: !!docDef?.expirable, uploadedBy: admin.id, daysBack: 7,
      }));
    }
    //  FIX: update "PCN" model record
    await updateRecord("PCN", pcn.id, {
      complianceGroups: selectedGroupIds,
      complianceGroup:  selectedGroupIds[0] || null,
      groupDocuments:   seededRecords,
    });
    log.ok(`Compliance groups assigned to ${pcn.name}`);
  }

  for (const practice of Object.values(practiceMap)) {
    const seededRecords = [];
    if (practicePrimaryGroup) {
      const docIds = (practicePrimaryGroup.documents || []).filter(Boolean);
      if (docIds.length) {
        const firstDocId = docIds[0];
        const docDef     = docsById[firstDocId];
        seededRecords.push(makeSeedGroupRecord({
          groupId: practicePrimaryGroup.id, documentId: firstDocId,
          documentName: docDef?.name || "Document",
          expirable: !!docDef?.expirable, uploadedBy: admin.id, daysBack: 5,
        }));
      }
    }
    await updateRecord("practice", practice.id, {
      complianceGroup: practicePrimaryGroup?.id || null,
      groupDocuments:  seededRecords,
    });
    log.ok(`Compliance group assigned to ${practice.name}`);
  }

  // ── Done 
  await disconnectDB();
  log.ok("\nSeed complete!");
  log.info(
    `Users: ${USERS.length} | ICBs: ${ICBS.length} | ` +
    `Federations: ${Object.keys(fedMap).length} | PCNs/Clients: ${Object.keys(pcnMap).length} | ` +
    `Practices: ${Object.keys(practiceMap).length} | ` +
    `Compliance Docs: ${COMPLIANCE_DOCS.length} | Document Groups: ${DOCUMENT_GROUPS.length}`
  );
}

/* ── Entry point  */
if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href
) {
  runSeed().catch(err => {
    log.error("Seed failed:", err.message);
    process.exit(1);
  });
}