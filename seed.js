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
 *   - Refactored: all static data moved to seed-data/ JSON files
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
import { createRequire } from "module";
import { initDB, query, disconnectDB } from "./config/db.js";
import { createId } from "./lib/ids.js";

const require = createRequire(import.meta.url);

/*   STATIC SEED DATA — loaded from JSON files   */
const USERS           = require("./seed-data/users.json");
const ICBS            = require("./seed-data/icbs.json");
const FEDERATION_DATA = require("./seed-data/federations.json");
const CLIENT_DATA     = require("./seed-data/clients.json");
const PRACTICE_DATA   = require("./seed-data/practices.json");
const HISTORY_TEMPLATES  = require("./seed-data/history-templates.json");
const COMPLIANCE_DOCS    = require("./seed-data/compliance-docs.json");
const DOCUMENT_GROUPS    = require("./seed-data/document-groups.json");
const CLINICIAN_SEED_RAW = require("./seed-data/clinicians.json");

const log = {
  info:  (msg, ...args) => console.log(`[INFO]  ${msg}`, ...args),
  ok:    (msg, ...args) => console.log(`[OK]    ${msg}`, ...args),
  warn:  (msg, ...args) => console.warn(`[WARN]  ${msg}`, ...args),
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

/*   DATE HELPERS   */
const daysAgo     = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

/**
 * Build a seed record for a document slot inside a group.
 */
const makeSeedGroupRecord = ({
  groupId, documentId, documentName, expirable, uploadedBy,
  daysBack = 10, mode = "missing",
}) => {
  const expiryDate = expirable ? new Date(Date.now() + 180 * 86_400_000).toISOString() : null;

  if (mode === "missing") {
    return {
      group: groupId, document: documentId,
      fileName: "", fileUrl: "", mimeType: "", fileSize: 0,
      status: "missing",
      approvalStatus: "not_uploaded",
      uploadedAt: null, expiryDate, renewalDate: null,
      notes: "Awaiting upload",
      uploadedBy: null, lastUpdatedBy: null,
      approvedBy: null, approvedAt: null,
      uploads: [],
    };
  }

  const uploadedAt = daysAgo(daysBack);
  const upload = {
    uploadId: createId(),
    fileName: `${String(documentName || "document").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`,
    fileUrl: `https://files.cps.local/${groupId}/${documentId}/${Date.now()}.pdf`,
    mimeType: "application/pdf",
    fileSize: 180000 + Math.floor(Math.random() * 70000),
    status: "uploaded", uploadedAt, expiryDate, renewalDate: null,
    notes: "Seeded upload - pending review",
    reference: `SEED-${String(documentId).slice(-6).toUpperCase()}`,
    uploadedBy,
    approvedBy: null, approvedAt: null,
  };
  return {
    group: groupId, document: documentId,
    fileName: upload.fileName, fileUrl: upload.fileUrl,
    mimeType: upload.mimeType, fileSize: upload.fileSize,
    status: "uploaded",
    approvalStatus: "pending",
    uploadedAt: upload.uploadedAt, expiryDate: upload.expiryDate, renewalDate: null,
    notes: upload.notes,
    uploadedBy, lastUpdatedBy: uploadedBy,
    approvedBy: null, approvedAt: null,
    uploads: [upload],
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

    const admin      = seededUsers.find((u) => u.role === "super_admin");
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
    const docsById            = Object.fromEntries(Object.values(docMap).map((d) => [d.id, d]));
    const clientPrimaryGroup  = groupMap["Clinical Staff Documents"];
    const clientSecondaryGroup= groupMap["DBS and Update"];
    const practicePrimaryGroup= groupMap["Non-Clinical Staff"] || clientPrimaryGroup || null;

    for (const [clientName, client] of Object.entries(clientMap)) {
      const selectedGroups   = [clientPrimaryGroup, clientSecondaryGroup].filter(Boolean);
      const selectedGroupIds = selectedGroups.map((g) => g.id);
      const seededRecords    = [];
      for (let g = 0; g < selectedGroups.length; g++) {
        const group  = selectedGroups[g];
        const docIds = (group.documents || []).filter(Boolean);
        if (!docIds.length) continue;
        const firstDocId = docIds[0];
        const docDef     = docsById[firstDocId];
        const mode = g === 0 ? "missing" : "uploaded";
        seededRecords.push(makeSeedGroupRecord({
          groupId: group.id, documentId: firstDocId,
          documentName: docDef?.name || "Document",
          expirable: !!docDef?.expirable,
          uploadedBy: admin.id, daysBack: 7, mode,
        }));
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
          seededRecords.push(makeSeedGroupRecord({
            groupId: practicePrimaryGroup.id, documentId: firstDocId,
            documentName: docDef?.name || "Document",
            expirable: !!docDef?.expirable,
            uploadedBy: admin.id, daysBack: 5, mode: "missing",
          }));
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

    /*
     * Resolve dynamic user IDs from the helper fields stored in clinicians.json
     * (_userEmail, _opsLeadRole, _supervisorRole) then strip them before inserting.
     */
    const CLINICIAN_SEED = CLINICIAN_SEED_RAW.map((raw) => {
      const { _userEmail, _opsLeadRole, _supervisorRole, ...data } = raw;
      const userRecord       = _userEmail ? seededUsers.find((u) => u.email === _userEmail) : null;
      const opsLeadRecord    = _opsLeadRole ? seededUsers.find((u) => u.role === _opsLeadRole) : null;
      const supervisorRecord = _supervisorRole ? seededUsers.find((u) => u.role === _supervisorRole) : null;
      return {
        ...data,
        startDate:  daysAgo(data.clinicianType === "Pharmacist" ? 180 : data.clinicianType === "Technician" ? 120 : 90),
        onboarding: {
          ...data.onboarding,
          welcomePackSentAt: daysAgo(data.clinicianType === "Pharmacist" ? 170 : data.clinicianType === "Technician" ? 115 : 85),
          welcomePackSentBy: admin.id,
        },
        cppeStatus: {
          ...data.cppeStatus,
          enrolledAt:   data.cppeStatus.enrolled ? daysAgo(data.clinicianType === "Pharmacist" ? 120 : 90) : null,
          completedAt:  null,
        },
        user:       userRecord?.id || null,
        opsLead:    opsLeadRecord?.id || null,
        supervisor: supervisorRecord?.id || admin.id,
        createdBy:  admin.id,
      };
    });

    const clinicianMap = {};
    for (const data of CLINICIAN_SEED) {
      const existing = await findRecord("Clinician", "email", data.email);
      if (existing) { log.info(`Clinician ${data.fullName} already exists - skipped`); clinicianMap[data.fullName] = existing; continue; }
      clinicianMap[data.fullName] = await insertRecord("Clinician", data);
      log.ok(`Clinician created: ${data.fullName} [${data.clinicianType} / ${data.contractType}]`);
    }

    const [clin1, clin2, clin3] = Object.values(clinicianMap);

    const salfordClient   = clientMap["Salford Central Client"];
    const prestonClient   = clientMap["Preston City Client"];
    const liverpoolClient = clientMap["Liverpool South Client"];
    const pendletonPrac   = practiceMap["Pendleton Medical Centre"];
    const fishergateP     = practiceMap["Fishergate Hill Surgery"];
    const spekePrac       = practiceMap["Speke Medical Centre"];

    /* ── Clinician Compliance Docs ────────────────────────── */
    log.info("\nSeeding Clinician Compliance Docs...");
    const CLINICIAN_COMPLIANCE_SEED = [
      { clinician: clin1?.id, docName: "DBS Check/Update Service",        status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
      { clinician: clin1?.id, docName: "Indemnity Insurance Certificate", status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
      { clinician: clin1?.id, docName: "CV",                              status: "uploaded", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(2),   approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin1?.id, docName: "Right to Work",                   status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
      { clinician: clin2?.id, docName: "DBS Check/Update Service",        status: "uploaded", mandatory: true,  expiryDate: daysFromNow(300), uploadedBy: "clinician", uploadedAt: daysAgo(3),   approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin2?.id, docName: "CV",                              status: "uploaded", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(5),   approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin2?.id, docName: "Indemnity Insurance Certificate", status: "expired",  mandatory: true,  expiryDate: daysAgo(10),      uploadedBy: "clinician", uploadedAt: daysAgo(375), approvedBy: null,     approvedAt: null,         notes: "Renewal required urgently" },
      { clinician: clin3?.id, docName: "CV",                              status: "approved", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(80),  approvedBy: admin.id, approvedAt: daysAgo(75),  notes: "Approved via UI" },
      { clinician: clin3?.id, docName: "Indemnity Insurance Certificate", status: "uploaded", mandatory: true,  expiryDate: daysFromNow(240), uploadedBy: "clinician", uploadedAt: daysAgo(4),   approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin3?.id, docName: "Right to Work",                   status: "uploaded", mandatory: true,  expiryDate: null,             uploadedBy: "clinician", uploadedAt: daysAgo(2),   approvedBy: null,     approvedAt: null,         notes: "Pending review" },
      { clinician: clin3?.id, docName: "Signed Non-Disclosure Agreement", status: "missing",  mandatory: true,  expiryDate: null,             uploadedBy: null,        uploadedAt: null,         approvedBy: null,     approvedAt: null,         notes: "Awaiting upload" },
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
      { clinician: clin1?.id, sessionDate: daysAgo(30), ragStatus: "green", supervisor: admin.id,                     notes: "Good progress. All targets met. No concerns.",               actionItems: [],                                                                      createdBy: admin.id },
      { clinician: clin1?.id, sessionDate: daysAgo(60), ragStatus: "amber", supervisor: admin.id,                     notes: "Minor documentation delays. Improvement plan discussed.",     actionItems: [{ text: "Submit outstanding notes", dueDate: daysAgo(50), done: true }], createdBy: admin.id },
      { clinician: clin2?.id, sessionDate: daysAgo(25), ragStatus: "green", supervisor: admin.id,                     notes: "Performing well in EA sessions. Patient feedback positive.",   actionItems: [],                                                                      createdBy: admin.id },
      { clinician: clin2?.id, sessionDate: daysAgo(55), ragStatus: "red",   supervisor: admin.id,                     notes: "Missed two EA shifts without notice. Formal warning issued.",  actionItems: [{ text: "Attend HR meeting", dueDate: daysAgo(45), done: true }],       createdBy: admin.id },
      { clinician: clin3?.id, sessionDate: daysAgo(14), ragStatus: "green", supervisor: trainingUser?.id || admin.id, notes: "Excellent prescribing record. No issues.",                    actionItems: [],                                                                      createdBy: admin.id },
      { clinician: clin3?.id, sessionDate: daysAgo(45), ragStatus: "green", supervisor: trainingUser?.id || admin.id, notes: "Care home reviews on track. Caseload manageable.",            actionItems: [],                                                                      createdBy: admin.id },
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
