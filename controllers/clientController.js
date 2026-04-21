/**
 * clientController.js — CPS Client Management
 * CONVERTED TO POSTGRESQL (Apr 2026)
 *
 * All MongoDB/Mongoose replaced with PostgreSQL query() from config/db.js
 * Data stored in app_records table:
 *   model = "icb"             → ICBs
 *   model = "federation"      → Federations
 *   model = "client"          → PCNs/Clients
 *   model = "practice"        → Practices
 *   model = "contact_history" → Contact History
 *   model = "audit_log"       → Audit logs
 */

import { v4 as uuidv4 } from "uuid";
import nodemailer        from "nodemailer";
import crypto            from "crypto";
import { query }         from "../config/db.js";
import { logAudit }      from "../middleware/auditLogger.js";
import { normalizeId }   from "../lib/ids.js";
import { uploadBufferToStorage } from "../lib/supabase.js";

/* ══════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════ */
const ICB_MODEL     = "icb";
const FED_MODEL     = "federation";
const CLIENT_MODEL  = "client";       // PCN
const PRACTICE_MODEL= "practice";
const HISTORY_MODEL = "contact_history";

/* ══════════════════════════════════════════════════════════════════
   DB HELPERS
══════════════════════════════════════════════════════════════════ */
function mapRow(row) {
  if (!row) return null;
  return {
    _id:       row.id,
    id:        row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || null,
  };
}

function mapRows(rows) {
  return (rows || []).map(mapRow).filter(Boolean);
}

async function findById(model, id) {
  if (!id) return null;
  const result = await query(
    `SELECT id, data, created_at, updated_at FROM app_records WHERE model = $1 AND id = $2 LIMIT 1`,
    [model, id]
  );
  return mapRow(result.rows[0]);
}

async function findAll(model, conditions = [], params = [], orderBy = "data->>'name' ASC") {
  const where = [`model = $1`, ...conditions].join(" AND ");
  const result = await query(
    `SELECT id, data, created_at, updated_at FROM app_records WHERE ${where} ORDER BY ${orderBy}`,
    [model, ...params]
  );
  return mapRows(result.rows);
}

async function insertRecord(model, payload) {
  const id        = uuidv4();
  const timestamp = new Date().toISOString();
  const data      = { ...payload, createdAt: timestamp, updatedAt: timestamp };
  const result    = await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRow(result.rows[0]);
}

async function updateRecord(model, id, patch) {
  const data   = { ...patch, updatedAt: new Date().toISOString() };
  const result = await query(
    `UPDATE app_records
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2
     RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRow(result.rows[0]);
}

async function softDelete(model, id) {
  return updateRecord(model, id, { isActive: false });
}

async function countActive(model, fieldPath, value) {
  const result = await query(
    `SELECT COUNT(*) FROM app_records
     WHERE model = $1
     AND COALESCE((data->>'isActive')::boolean, true) = true
     AND data->'${fieldPath}' @> $2::jsonb`,
    [model, JSON.stringify(value)]
  );
  return parseInt(result.rows[0].count, 10);
}

/* ══════════════════════════════════════════════════════════════════
   SHARED HELPERS
══════════════════════════════════════════════════════════════════ */
const normalizeEntityType = (entityType = "") => {
  const n = String(entityType).trim().toLowerCase();
  if (n === "pcn"  || n === "client") return "Client";
  if (n === "practice")               return "Practice";
  if (n === "federation")             return "Federation";
  if (n === "icb")                    return "ICB";
  const err = new Error("Invalid entityType"); err.statusCode = 400; throw err;
};

const getModelByEntityType = (entityType) => {
  if (entityType === "Client")      return CLIENT_MODEL;
  if (entityType === "Practice")    return PRACTICE_MODEL;
  if (entityType === "Federation")  return FED_MODEL;
  if (entityType === "ICB")         return ICB_MODEL;
  const err = new Error("Invalid entityType"); err.statusCode = 400; throw err;
};

const validateId = (id, label = "id") => {
  const v = normalizeId(id);
  if (!v) { const err = new Error(`Invalid ${label}`); err.statusCode = 400; throw err; }
  return v;
};

const normalizeComplianceGroup = (payload = {}) => {
  const next = { ...payload };
  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroups")) {
    const groups = Array.from(new Set(
      (Array.isArray(payload.complianceGroups) ? payload.complianceGroups : [payload.complianceGroups])
        .map(v => String(v || "").trim()).filter(Boolean)
    ));
    next.complianceGroups = groups;
    next.complianceGroup  = groups[0] || null;
    return next;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
    next.complianceGroup  = payload.complianceGroup || null;
    next.complianceGroups = next.complianceGroup ? [next.complianceGroup] : [];
  }
  return next;
};

/* ── Email ─────────────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ══════════════════════════════════════════════════════════════════
   REPORTING ARCHIVE
══════════════════════════════════════════════════════════════════ */
export const getReportingArchive = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);
    const { month, year } = req.query;

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    let archive = Array.isArray(entity.reportingArchive) ? entity.reportingArchive : [];
    if (month) archive = archive.filter(r => String(r.month) === String(month));
    if (year)  archive = archive.filter(r => String(r.year)  === String(year));
    archive = [...archive].sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month);

    res.json({ archive, total: archive.length, entityName: entity.name });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch reporting archive" });
  }
};

export const addToReportingArchive = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const { month, year, notes, starred } = req.body;
    if (!month || !year) return res.status(400).json({ message: "month and year are required" });
    if (!req.file)        return res.status(400).json({ message: "A report file is required" });

    const uploaded = await uploadBufferToStorage({
      buffer: req.file.buffer, contentType: req.file.mimetype || "application/octet-stream",
      fileName: req.file.originalname || "report.pdf",
    });

    const reportEntry = {
      id: uuidv4(), month: Number(month), year: Number(year),
      reportUrl: uploaded.publicUrl, fileName: req.file.originalname || "report.pdf",
      uploadedAt: new Date().toISOString(), uploadedBy: req.user._id,
      notes: notes?.trim() || "", starred: starred === "true" || starred === true,
    };

    const archive = [...(entity.reportingArchive || []), reportEntry];
    await updateRecord(model, entityId, { reportingArchive: archive });

    // Auto contact history entry
    await insertRecord(HISTORY_MODEL, {
      entityType, entityId, type: "report",
      subject: `Monthly Report — ${String(month).padStart(2, "0")}/${year}`,
      notes: notes?.trim() || "", date: new Date().toISOString(),
      time: new Date().toTimeString().slice(0, 5), starred: true,
      createdBy: req.user._id,
    });

    await logAudit(req, "REPORTING_ARCHIVE_ADD", entityType, {
      resourceId: entityId, detail: `Report uploaded: ${reportEntry.fileName} (${month}/${year})`,
    });

    res.status(201).json({ message: "Report added to archive", report: reportEntry });
  } catch (err) {
    console.error("addToReportingArchive ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to add report" });
  }
};

export const deleteFromReportingArchive = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);
    const { reportId } = req.params;

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const before  = (entity.reportingArchive || []).length;
    const archive = (entity.reportingArchive || []).filter(r => r.id !== reportId);
    if (archive.length === before) return res.status(404).json({ message: "Report not found in archive" });

    await updateRecord(model, entityId, { reportingArchive: archive });
    await logAudit(req, "REPORTING_ARCHIVE_DELETE", entityType, {
      resourceId: entityId, detail: `Report removed (reportId: ${reportId})`,
    });

    res.json({ message: "Report deleted from archive" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete report" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   DECISION MAKERS
══════════════════════════════════════════════════════════════════ */
export const getDecisionMakers = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    res.json({ decisionMakers: entity.decisionMakers || [], entityName: entity.name });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch decision makers" });
  }
};

export const updateDecisionMakers = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);
    const { decisionMakers } = req.body;

    if (!Array.isArray(decisionMakers))
      return res.status(400).json({ message: "decisionMakers must be an array" });
    for (const dm of decisionMakers) {
      if (!dm.name?.trim() || !dm.email?.trim())
        return res.status(400).json({ message: "Each decision maker requires name and email" });
    }

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    await updateRecord(model, entityId, { decisionMakers });
    await logAudit(req, "UPDATE_DECISION_MAKERS", entityType, {
      resourceId: entityId, detail: `Decision makers updated (${decisionMakers.length} entries)`,
    });

    res.json({ decisionMakers, entityName: entity.name, message: "Decision makers updated" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update decision makers" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   FINANCE CONTACTS
══════════════════════════════════════════════════════════════════ */
export const getFinanceContacts = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    res.json({ financeContacts: entity.financeContacts || [], entityName: entity.name });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch finance contacts" });
  }
};

export const updateFinanceContacts = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const model      = getModelByEntityType(entityType);
    const entityId   = validateId(req.params.entityId, `${entityType} id`);
    const { financeContacts } = req.body;

    if (!Array.isArray(financeContacts))
      return res.status(400).json({ message: "financeContacts must be an array" });

    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    await updateRecord(model, entityId, { financeContacts });
    await logAudit(req, "UPDATE_FINANCE_CONTACTS", entityType, {
      resourceId: entityId, detail: `Finance contacts updated (${financeContacts.length} entries)`,
    });

    res.json({ financeContacts, entityName: entity.name, message: "Finance contacts updated" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update finance contacts" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   CLIENT FACING DATA
══════════════════════════════════════════════════════════════════ */
export const getClientFacingData = async (req, res) => {
  try {
    const clientId = validateId(req.params.id, "client id");
    const client   = await findById(CLIENT_MODEL, clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const now = new Date();
    const upcomingMeetings = (client.monthlyMeetings || [])
      .filter(m => m.date && new Date(m.date) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Fetch linked clinicians names
    const clinicians = [];
    for (const cId of (client.activeClinicians || [])) {
      const u = await findById("user", cId);
      if (u) clinicians.push({ _id: u._id, name: u.name, role: u.role });
    }

    res.json({
      clientFacingData: client.clientFacingData || {},
      upcomingMeetings,
      clinicians,
      entityName: client.name,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: "Failed to fetch client-facing data" });
  }
};

export const updateClientFacingData = async (req, res) => {
  try {
    const clientId = validateId(req.params.id, "client id");
    const { showMonthlyMeetings, showClinicianMeetings, publicNotes } = req.body;

    const client = await findById(CLIENT_MODEL, clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const existing = client.clientFacingData || {};
    const clientFacingData = {
      ...existing,
      ...(showMonthlyMeetings   !== undefined && { showMonthlyMeetings }),
      ...(showClinicianMeetings !== undefined && { showClinicianMeetings }),
      ...(publicNotes           !== undefined && { publicNotes: publicNotes?.trim() || "" }),
      lastUpdated: new Date().toISOString(),
    };

    await updateRecord(CLIENT_MODEL, clientId, { clientFacingData });
    await logAudit(req, "UPDATE_CLIENT_FACING", "Client", {
      resourceId: clientId, detail: `Client-facing data updated for: ${client.name}`,
    });

    res.json({ clientFacingData, entityName: client.name, message: "Client-facing data updated" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: "Failed to update client-facing data" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   HIERARCHY
══════════════════════════════════════════════════════════════════ */
export const getHierarchy = async (req, res) => {
  try {
    const [icbs, federations, clients, practices] = await Promise.all([
      findAll(ICB_MODEL,      [`COALESCE((data->>'isActive')::boolean, true) = true`]),
      findAll(FED_MODEL,      [`COALESCE((data->>'isActive')::boolean, true) = true`]),
      findAll(CLIENT_MODEL,   [`COALESCE((data->>'isActive')::boolean, true) = true`]),
      findAll(PRACTICE_MODEL, [`COALESCE((data->>'isActive')::boolean, true) = true`]),
    ]);

    // Build federation map
    const fedMapById = {};
    for (const f of federations) fedMapById[f._id] = f;

    // Group practices by client id
    const practicesByClient = {};
    for (const p of practices) {
      const key = p.client?._id || p.client?.id || p.client;
      if (!key) continue;
      if (!practicesByClient[key]) practicesByClient[key] = [];
      practicesByClient[key].push(p);
    }

    // Group clients by ICB id
    const clientsByICB = {};
    for (const c of clients) {
      const icbKey = c.icb?._id || c.icb?.id || c.icb;
      if (!icbKey) continue;
      const fed = c.federation
        ? (fedMapById[c.federation?._id || c.federation?.id || c.federation] || c.federation)
        : null;
      if (!clientsByICB[icbKey]) clientsByICB[icbKey] = [];
      clientsByICB[icbKey].push({ ...c, federation: fed, practices: practicesByClient[c._id] || [] });
    }

    const tree = icbs.map(icb => ({
      ...icb,
      federations: federations.filter(f => {
        const ficb = f.icb?._id || f.icb?.id || f.icb;
        return String(ficb) === String(icb._id);
      }),
      pcns: clientsByICB[icb._id] || [],
    }));

    res.json({
      tree,
      counts: { icbs: icbs.length, federations: federations.length, pcns: clients.length, practices: practices.length },
    });
  } catch (err) {
    console.error("getHierarchy ERROR:", err.message);
    res.status(500).json({ message: "Failed to load hierarchy", detail: err.message });
  }
};

/* ══════════════════════════════════════════════════════════════════
   ICB CRUD
══════════════════════════════════════════════════════════════════ */
export const getICBs = async (req, res) => {
  try {
    const icbs = await findAll(ICB_MODEL, [`COALESCE((data->>'isActive')::boolean, true) = true`]);
    res.json({ icbs });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch ICBs" });
  }
};

export const getICBById = async (req, res) => {
  try {
    const icb = await findById(ICB_MODEL, req.params.id);
    if (!icb) return res.status(404).json({ message: "ICB not found" });

    const federations = await query(
      `SELECT id, data FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND data->>'icb' = $2 ORDER BY data->>'name' ASC`,
      [FED_MODEL, req.params.id]
    ).then(r => mapRows(r.rows));

    // Clients for this ICB
    const clientsRaw = await query(
      `SELECT id, data FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'icb'->>'_id' = $2 OR data->'icb'->>'id' = $2 OR data->>'icb' = $2)
       ORDER BY data->>'name' ASC`,
      [CLIENT_MODEL, req.params.id]
    ).then(r => mapRows(r.rows));

    // Practices for those clients
    const clientIds = clientsRaw.map(c => c._id);
    const practicesByClient = {};
    if (clientIds.length) {
      for (const cId of clientIds) {
        const pracs = await query(
          `SELECT id, data FROM app_records WHERE model = $1
           AND COALESCE((data->>'isActive')::boolean, true) = true
           AND (data->'client'->>'_id' = $2 OR data->'client'->>'id' = $2 OR data->>'client' = $2)`,
          [PRACTICE_MODEL, cId]
        ).then(r => mapRows(r.rows));
        practicesByClient[cId] = pracs;
      }
    }

    const pcns = clientsRaw.map(c => ({ ...c, practices: practicesByClient[c._id] || [] }));
    res.json({ icb: { ...icb, federations, pcns } });
  } catch (err) {
    console.error("getICBById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch ICB" });
  }
};

export const createICB = async (req, res) => {
  try {
    const { name, region, code, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "ICB name is required" });

    // Duplicate check
    const existing = await query(
      `SELECT id FROM app_records WHERE model = $1 AND LOWER(data->>'name') = LOWER($2) LIMIT 1`,
      [ICB_MODEL, name.trim()]
    );
    if (existing.rows.length) return res.status(409).json({ message: "An ICB with this name already exists" });

    const icb = await insertRecord(ICB_MODEL, {
      name: name.trim(), region: region || "", code: code || "",
      notes: notes || "", isActive: true, createdBy: req.user._id,
    });
    res.status(201).json({ icb, message: "ICB created successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to create ICB" });
  }
};

export const updateICB = async (req, res) => {
  try {
    const { name, region, code, notes, isActive } = req.body;
    const icb = await findById(ICB_MODEL, req.params.id);
    if (!icb) return res.status(404).json({ message: "ICB not found" });

    const updated = await updateRecord(ICB_MODEL, req.params.id, {
      ...(name     !== undefined && { name }),
      ...(region   !== undefined && { region }),
      ...(code     !== undefined && { code }),
      ...(notes    !== undefined && { notes }),
      ...(isActive !== undefined && { isActive }),
    });
    res.json({ icb: updated, message: "ICB updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update ICB" });
  }
};

export const deleteICB = async (req, res) => {
  try {
    // Count linked active clients
    const clientCount = await query(
      `SELECT COUNT(*) FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'icb'->>'_id' = $2 OR data->'icb'->>'id' = $2 OR data->>'icb' = $2)`,
      [CLIENT_MODEL, req.params.id]
    ).then(r => parseInt(r.rows[0].count, 10));

    const fedCount = await query(
      `SELECT COUNT(*) FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->>'icb' = $2 OR data->'icb'->>'_id' = $2)`,
      [FED_MODEL, req.params.id]
    ).then(r => parseInt(r.rows[0].count, 10));

    if (clientCount > 0 || fedCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${clientCount} active client(s) and ${fedCount} federation(s) are linked` });

    await softDelete(ICB_MODEL, req.params.id);
    res.json({ message: "ICB deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete ICB" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   FEDERATION CRUD
══════════════════════════════════════════════════════════════════ */
export const getFederations = async (req, res) => {
  try {
    const conditions = [`COALESCE((data->>'isActive')::boolean, true) = true`];
    const params = [];

    if (req.query.icb) {
      conditions.push(`(data->>'icb' = $2 OR data->'icb'->>'_id' = $2 OR data->'icb'->>'id' = $2)`);
      params.push(req.query.icb);
    }

    const federations = await findAll(FED_MODEL, conditions, params);
    // Populate ICB name
    const result = await Promise.all(federations.map(async f => {
      const icbId = f.icb?._id || f.icb?.id || f.icb;
      if (icbId && typeof icbId === "string") {
        const icb = await findById(ICB_MODEL, icbId);
        return { ...f, icb: icb ? { _id: icb._id, name: icb.name, region: icb.region } : f.icb };
      }
      return f;
    }));
    res.json({ federations: result });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch federations" });
  }
};

export const createFederation = async (req, res) => {
  try {
    const { name, icb, type, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Federation name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });

    const icbRecord = await findById(ICB_MODEL, icb);
    const fed = await insertRecord(FED_MODEL, {
      name: name.trim(), type: type || "federation", notes: notes || "", isActive: true,
      icb: icbRecord ? { _id: icbRecord._id, name: icbRecord.name } : icb,
      createdBy: req.user._id,
    });
    res.status(201).json({ federation: fed, message: "Federation created" });
  } catch (err) {
    res.status(500).json({ message: "Failed to create federation" });
  }
};

export const updateFederation = async (req, res) => {
  try {
    const fed = await findById(FED_MODEL, req.params.id);
    if (!fed) return res.status(404).json({ message: "Federation not found" });

    const { name, type, notes, isActive, icb } = req.body;
    const updated = await updateRecord(FED_MODEL, req.params.id, {
      ...(name     !== undefined && { name }),
      ...(type     !== undefined && { type }),
      ...(notes    !== undefined && { notes }),
      ...(isActive !== undefined && { isActive }),
      ...(icb      !== undefined && { icb }),
    });
    res.json({ federation: updated, message: "Federation updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update federation" });
  }
};

export const deleteFederation = async (req, res) => {
  try {
    const clientCount = await query(
      `SELECT COUNT(*) FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'federation'->>'_id' = $2 OR data->'federation'->>'id' = $2 OR data->>'federation' = $2)`,
      [CLIENT_MODEL, req.params.id]
    ).then(r => parseInt(r.rows[0].count, 10));

    if (clientCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${clientCount} active client(s) are linked` });

    await softDelete(FED_MODEL, req.params.id);
    res.json({ message: "Federation deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete federation" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   PCN / CLIENT CRUD
══════════════════════════════════════════════════════════════════ */
export const getPCNs = async (req, res) => {
  try {
    const conditions = [`COALESCE((data->>'isActive')::boolean, true) = true`];
    const params = [];

    if (req.query.icb) {
      conditions.push(`(data->'icb'->>'_id' = $${params.length + 2} OR data->'icb'->>'id' = $${params.length + 2} OR data->>'icb' = $${params.length + 2})`);
      params.push(req.query.icb);
    }
    if (req.query.federation) {
      conditions.push(`(data->'federation'->>'_id' = $${params.length + 2} OR data->>'federation' = $${params.length + 2})`);
      params.push(req.query.federation);
    }

    const pcns = await findAll(CLIENT_MODEL, conditions, params);
    res.json({ pcns });
  } catch (err) {
    console.error("getPCNs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch PCNs" });
  }
};

export const getPCNById = async (req, res) => {
  try {
    const client = await findById(CLIENT_MODEL, req.params.id);
    if (!client) return res.status(404).json({ message: "PCN not found" });

    // Last 3 reporting archive entries
    if (Array.isArray(client.reportingArchive)) {
      client.reportingArchive = [...client.reportingArchive]
        .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
        .slice(0, 3);
    }

    // Get practices
    const practicesResult = await query(
      `SELECT id, data FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'client'->>'_id' = $2 OR data->'client'->>'id' = $2 OR data->>'client' = $2)
       ORDER BY data->>'name' ASC`,
      [PRACTICE_MODEL, req.params.id]
    );
    client.practices = mapRows(practicesResult.rows);

    res.json({ pcn: client });
  } catch (err) {
    console.error("getPCNById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch PCN", detail: err.message });
  }
};

export const createPCN = async (req, res) => {
  try {
    const { name, icb, decisionMakers, financeContacts, tags, priority, clientFacingData } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "PCN name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });

    // Embed ICB object
    const icbRecord = await findById(ICB_MODEL, icb);
    const fedId     = req.body.federation;
    const fedRecord = fedId ? await findById(FED_MODEL, fedId) : null;

    const payload = normalizeComplianceGroup({
      ...req.body,
      name: name.trim(),
      icb:  icbRecord ? { _id: icbRecord._id, name: icbRecord.name, code: icbRecord.code, region: icbRecord.region } : icb,
      federation: fedRecord ? { _id: fedRecord._id, name: fedRecord.name, type: fedRecord.type } : (fedId || null),
      federationName: fedRecord?.name || "",
      decisionMakers:  decisionMakers  || [],
      financeContacts: financeContacts || [],
      tags:            Array.isArray(tags) ? tags : [],
      priority:        priority || "normal",
      clientFacingData: clientFacingData || { showMonthlyMeetings: true, showClinicianMeetings: true, publicNotes: "" },
      isActive: true,
      createdBy: req.user._id,
    });

    const pcn = await insertRecord(CLIENT_MODEL, payload);

    await logAudit(req, "CREATE_CLIENT", "Client", {
      resourceId: pcn._id, detail: `Client created: ${pcn.name}`, after: pcn,
    });
    res.status(201).json({ pcn, message: "PCN created" });
  } catch (err) {
    console.error("createPCN ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create PCN" });
  }
};

export const updatePCN = async (req, res) => {
  try {
    validateId(req.params.id, "PCN id");
    const existing = await findById(CLIENT_MODEL, req.params.id);
    if (!existing) return res.status(404).json({ message: "PCN not found" });

    let payload = normalizeComplianceGroup(req.body);

    // Clear groupDocuments if compliance groups changed
    if (
      Object.prototype.hasOwnProperty.call(payload, "complianceGroups") ||
      Object.prototype.hasOwnProperty.call(payload, "complianceGroup")
    ) {
      const prevGroups = [...(existing.complianceGroups || []), ...(existing.complianceGroup ? [existing.complianceGroup] : [])].map(String).sort();
      const nextGroups = [...(payload.complianceGroups  || []), ...(payload.complianceGroup  ? [payload.complianceGroup]  : [])].map(String).sort();
      if (JSON.stringify(prevGroups) !== JSON.stringify(nextGroups)) payload.groupDocuments = [];
    }

    // Embed ICB/Federation if IDs changed
    if (req.body.icb && typeof req.body.icb === "string") {
      const icbRecord = await findById(ICB_MODEL, req.body.icb);
      if (icbRecord) payload.icb = { _id: icbRecord._id, name: icbRecord.name, code: icbRecord.code, region: icbRecord.region };
    }
    if (req.body.federation && typeof req.body.federation === "string") {
      const fedRecord = await findById(FED_MODEL, req.body.federation);
      if (fedRecord) { payload.federation = { _id: fedRecord._id, name: fedRecord.name, type: fedRecord.type }; payload.federationName = fedRecord.name; }
    }

    // Selective merge for new fields
    if (!Object.prototype.hasOwnProperty.call(req.body, "decisionMakers"))  delete payload.decisionMakers;
    if (!Object.prototype.hasOwnProperty.call(req.body, "financeContacts")) delete payload.financeContacts;
    if (!Object.prototype.hasOwnProperty.call(req.body, "tags"))            delete payload.tags;
    if (!Object.prototype.hasOwnProperty.call(req.body, "priority"))        delete payload.priority;
    if (Object.prototype.hasOwnProperty.call(req.body, "clientFacingData")) {
      payload.clientFacingData = { ...(req.body.clientFacingData || {}), lastUpdated: new Date().toISOString() };
    } else { delete payload.clientFacingData; }

    const pcn = await updateRecord(CLIENT_MODEL, req.params.id, payload);
    await logAudit(req, "UPDATE_CLIENT", "Client", {
      resourceId: pcn._id, detail: `Client updated: ${pcn.name}`,
      before: existing, after: pcn,
    });
    res.json({ pcn, message: "PCN updated" });
  } catch (err) {
    console.error("updatePCN ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update PCN" });
  }
};

export const deletePCN = async (req, res) => {
  try {
    validateId(req.params.id, "PCN id");
    const practiceCount = await query(
      `SELECT COUNT(*) FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'client'->>'_id' = $2 OR data->'client'->>'id' = $2 OR data->>'client' = $2)`,
      [PRACTICE_MODEL, req.params.id]
    ).then(r => parseInt(r.rows[0].count, 10));

    if (practiceCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${practiceCount} active practice(s) are linked` });

    const existing = await findById(CLIENT_MODEL, req.params.id);
    await softDelete(CLIENT_MODEL, req.params.id);

    await logAudit(req, "DELETE_CLIENT", "Client", {
      resourceId: req.params.id, detail: `Client soft-deleted: ${existing?.name}`,
      before: existing, after: { isActive: false },
    });
    res.json({ message: "PCN deleted" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete PCN" });
  }
};

export const updateRestrictedClinicians = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });

    const pcn = await findById(CLIENT_MODEL, req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const updated = await updateRecord(CLIENT_MODEL, req.params.id, { restrictedClinicians: clinicianIds });
    res.json({ pcn: updated, message: "Restricted clinicians updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ── Meetings & Rollup ───────────────────────────────────────────── */
export const getMonthlyMeetings = async (req, res) => {
  try {
    const pcn = await findById(CLIENT_MODEL, req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ meetings: pcn.monthlyMeetings || [], pcnName: pcn.name });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch meetings" });
  }
};

export const upsertMonthlyMeeting = async (req, res) => {
  try {
    const { month, date, type, attendees, notes, status } = req.body;
    if (!month) return res.status(400).json({ message: "Month is required" });

    const pcn = await findById(CLIENT_MODEL, req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const meetings = Array.isArray(pcn.monthlyMeetings) ? [...pcn.monthlyMeetings] : [];
    const idx = meetings.findIndex(m => m.month === month && m.type === type);
    if (idx > -1) Object.assign(meetings[idx], { date, attendees, notes, status });
    else meetings.push({ month, date, type, attendees, notes, status });

    await updateRecord(CLIENT_MODEL, req.params.id, { monthlyMeetings: meetings });
    res.json({ meetings, message: "Meeting saved" });
  } catch (err) {
    res.status(500).json({ message: "Failed to save meeting" });
  }
};

export const getPCNRollup = async (req, res) => {
  try {
    const pcn = await findById(CLIENT_MODEL, req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const practicesResult = await query(
      `SELECT id, data FROM app_records WHERE model = $1
       AND COALESCE((data->>'isActive')::boolean, true) = true
       AND (data->'client'->>'_id' = $2 OR data->'client'->>'id' = $2 OR data->>'client' = $2)`,
      [PRACTICE_MODEL, req.params.id]
    );
    const practices = mapRows(practicesResult.rows);

    const complianceKeys = ["ndaSigned","dsaSigned","mouReceived","welcomePackSent","mobilisationPlanSent","confidentialityFormSigned","prescribingPoliciesShared","remoteAccessSetup","templateInstalled","reportsImported"];
    const complianceByPractice = practices.map(p => {
      const done = complianceKeys.filter(k => p[k]).length;
      return { practiceId: p._id, practiceName: p.name, done, total: complianceKeys.length, score: Math.round((done / complianceKeys.length) * 100) };
    });
    const avgCompliance = complianceByPractice.length
      ? Math.round(complianceByPractice.reduce((s, p) => s + p.score, 0) / complianceByPractice.length) : 0;

    res.json({ pcn, practices, rollup: { practiceCount: practices.length, avgCompliance, complianceByPractice, annualSpend: pcn.annualSpend } });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate rollup report" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   PRACTICE CRUD
══════════════════════════════════════════════════════════════════ */
export const getPractices = async (req, res) => {
  try {
    const conditions = [`COALESCE((data->>'isActive')::boolean, true) = true`];
    const params = [];

    if (req.query.pcn) {
      conditions.push(`(data->'client'->>'_id' = $2 OR data->'client'->>'id' = $2 OR data->>'client' = $2)`);
      params.push(req.query.pcn);
    }

    const practices = await findAll(PRACTICE_MODEL, conditions, params);
    res.json({ practices });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch practices" });
  }
};

export const getPracticeById = async (req, res) => {
  try {
    const practice = await findById(PRACTICE_MODEL, req.params.id);
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    // Last 3 reporting archive
    if (Array.isArray(practice.reportingArchive)) {
      practice.reportingArchive = [...practice.reportingArchive]
        .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
        .slice(0, 3);
    }

    res.json({ practice });
  } catch (err) {
    console.error("getPracticeById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch practice" });
  }
};

export const createPractice = async (req, res) => {
  try {
    const { name, pcn } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Practice name is required" });
    if (!pcn)          return res.status(400).json({ message: "PCN is required" });

    // Embed client reference
    const clientRecord = await findById(CLIENT_MODEL, pcn);
    const payload = normalizeComplianceGroup({
      ...req.body,
      name: name.trim(),
      client: clientRecord ? { _id: clientRecord._id, name: clientRecord.name } : pcn,
      isActive: true,
      createdBy: req.user._id,
    });

    const practice = await insertRecord(PRACTICE_MODEL, payload);
    await logAudit(req, "CREATE_CLIENT", "Practice", {
      resourceId: practice._id, detail: `Practice created: ${practice.name}`, after: practice,
    });
    res.status(201).json({ practice, message: "Practice created" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to create practice" });
  }
};

export const updatePractice = async (req, res) => {
  try {
    validateId(req.params.id, "Practice id");
    const existing = await findById(PRACTICE_MODEL, req.params.id);
    if (!existing) return res.status(404).json({ message: "Practice not found" });

    let payload = normalizeComplianceGroup(req.body);

    // Clear groupDocuments if compliance group changed
    if (Object.prototype.hasOwnProperty.call(payload, "complianceGroup")) {
      const prev = String(existing.complianceGroup?._id || existing.complianceGroup || "");
      const next = String(payload.complianceGroup || "");
      if (prev !== next) payload.groupDocuments = [];
    }

    // Embed client reference if changed
    if (req.body.pcn && typeof req.body.pcn === "string") {
      const clientRecord = await findById(CLIENT_MODEL, req.body.pcn);
      if (clientRecord) payload.client = { _id: clientRecord._id, name: clientRecord.name };
      delete payload.pcn;
    }

    const practice = await updateRecord(PRACTICE_MODEL, req.params.id, payload);
    await logAudit(req, "UPDATE_CLIENT", "Practice", {
      resourceId: practice._id, detail: `Practice updated: ${practice.name}`,
      before: existing, after: practice,
    });
    res.json({ practice, message: "Practice updated" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to update practice" });
  }
};

export const deletePractice = async (req, res) => {
  try {
    validateId(req.params.id, "Practice id");
    const existing = await findById(PRACTICE_MODEL, req.params.id);
    await softDelete(PRACTICE_MODEL, req.params.id);

    await logAudit(req, "DELETE_CLIENT", "Practice", {
      resourceId: req.params.id, detail: `Practice soft-deleted: ${existing?.name}`,
      before: existing, after: { isActive: false },
    });
    res.json({ message: "Practice deleted" });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to delete practice" });
  }
};

export const updatePracticeRestricted = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });

    const practice = await findById(PRACTICE_MODEL, req.params.id);
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    const updated = await updateRecord(PRACTICE_MODEL, req.params.id, { restrictedClinicians: clinicianIds });
    res.json({ practice: updated, message: "Restricted clinicians updated" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   CONTACT HISTORY
══════════════════════════════════════════════════════════════════ */
export const getContactHistory = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = validateId(req.params.entityId, "entityId");
    const { type, starred, page = 1, limit = 100 } = req.query;

    // Verify entity exists
    const model  = getModelByEntityType(entityType);
    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    // Build conditions
    const conditions = [
      `data->>'entityId' = $2`,
      `data->>'entityType' = $3`,
    ];
    const params = [entityId, entityType];
    let idx = 4;

    if (type && type !== "all") { conditions.push(`data->>'type' = $${idx++}`); params.push(type); }
    if (starred === "true")      { conditions.push(`(data->>'starred')::boolean = true`); }

    const offset  = (Number(page) - 1) * Number(limit);
    const where   = [`model = $1`, ...conditions].join(" AND ");

    const [logsResult, countResult] = await Promise.all([
      query(
        `SELECT id, data, created_at FROM app_records WHERE ${where}
         ORDER BY COALESCE(data->>'date', created_at::text) DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [HISTORY_MODEL, ...params, Number(limit), offset]
      ),
      query(`SELECT COUNT(*) FROM app_records WHERE ${where}`, [HISTORY_MODEL, ...params]),
    ]);

    const logs  = mapRows(logsResult.rows);
    const total = parseInt(countResult.rows[0].count, 10);

    // Populate createdBy
    const populated = await Promise.all(logs.map(async log => {
      if (log.createdBy && typeof log.createdBy === "string") {
        const u = await findById("user", log.createdBy);
        return { ...log, createdBy: u ? { _id: u._id, name: u.name, role: u.role } : log.createdBy };
      }
      return log;
    }));

    res.json({ logs: populated, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error("getContactHistory ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to fetch contact history" });
  }
};

export const addContactHistory = async (req, res) => {
  try {
    const entityType = normalizeEntityType(req.params.entityType);
    const entityId   = validateId(req.params.entityId, "entityId");
    const { type, subject, notes, date, time, attachments, outcome, followUpDate, followUpNote } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!type)            return res.status(400).json({ message: "Type is required" });

    // Verify entity exists
    const model  = getModelByEntityType(entityType);
    const entity = await findById(model, entityId);
    if (!entity) return res.status(404).json({ message: `${entityType} not found` });

    const log = await insertRecord(HISTORY_MODEL, {
      entityType, entityId, type,
      subject:     subject.trim(),
      notes:       notes || "",
      date:        date ? new Date(date).toISOString() : new Date().toISOString(),
      time:        time || new Date().toTimeString().slice(0, 5),
      attachments: attachments || [],
      outcome:     outcome?.trim()    || "",
      followUpDate: followUpDate ? new Date(followUpDate).toISOString() : null,
      followUpNote: followUpNote?.trim() || "",
      starred:     false,
      createdBy:   req.user._id,
    });

    // Populate createdBy for response
    const u = await findById("user", req.user._id);
    const populated = { ...log, createdBy: u ? { _id: u._id, name: u.name, role: u.role } : req.user._id };

    res.status(201).json({ log: populated, message: "Log added" });
  } catch (err) {
    console.error("addContactHistory ERROR:", err.message);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Failed to add log" });
  }
};

export const updateContactHistory = async (req, res) => {
  try {
    const logId = validateId(req.params.logId, "logId");
    const { subject, notes, type, date, time, outcome, followUpDate, followUpNote } = req.body;

    const log = await findById(HISTORY_MODEL, logId);
    if (!log) return res.status(404).json({ message: "Log not found" });

    const updated = await updateRecord(HISTORY_MODEL, logId, {
      ...(subject           !== undefined && { subject }),
      ...(notes             !== undefined && { notes }),
      ...(type              !== undefined && { type }),
      ...(date              !== undefined && { date }),
      ...(time              !== undefined && { time }),
      ...(outcome           !== undefined && { outcome: outcome?.trim() || "" }),
      ...(followUpDate      !== undefined && { followUpDate: followUpDate ? new Date(followUpDate).toISOString() : null }),
      ...(followUpNote      !== undefined && { followUpNote: followUpNote?.trim() || "" }),
    });

    const u = await findById("user", updated.createdBy?._id || updated.createdBy);
    const populated = { ...updated, createdBy: u ? { _id: u._id, name: u.name, role: u.role } : updated.createdBy };

    res.json({ log: populated, message: "Log updated" });
  } catch (err) {
    console.error("updateContactHistory ERROR:", err.message);
    res.status(500).json({ message: "Failed to update log" });
  }
};

export const toggleStarred = async (req, res) => {
  try {
    const log = await findById(HISTORY_MODEL, req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    const starred    = !log.starred;
    const updatedLog = await updateRecord(HISTORY_MODEL, req.params.logId, { starred });
    res.json({ log: updatedLog, starred, message: starred ? "Starred" : "Unstarred" });
  } catch (err) {
    res.status(500).json({ message: "Failed to toggle star" });
  }
};

export const deleteContactHistory = async (req, res) => {
  try {
    const logId = validateId(req.params.logId, "logId");
    const result = await query(
      `DELETE FROM app_records WHERE model = $1 AND id = $2 RETURNING id`,
      [HISTORY_MODEL, logId]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Log not found" });
    res.json({ message: "Log deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete log" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   SYSTEM ACCESS REQUEST
══════════════════════════════════════════════════════════════════ */
export const requestSystemAccess = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { systems, clinicianDetails, notes } = req.body;
    if (!systems?.length)        return res.status(400).json({ message: "At least one system must be selected" });
    if (!clinicianDetails?.name) return res.status(400).json({ message: "Clinician name is required" });

    const validatedId = validateId(entityId, "entityId");
    const systemList  = systems.join(", ");
    const emailBody   = `Dear Team,\n\nPlease arrange system access for:\n\nName: ${clinicianDetails.name}\nType: ${clinicianDetails.clinicianType || "N/A"}\nGPhC: ${clinicianDetails.gphcNumber || "N/A"}\nSmart Card: ${clinicianDetails.smartCardNumber || "N/A"}\nEmail: ${clinicianDetails.email || "N/A"}\nPhone: ${clinicianDetails.phone || "N/A"}\n\nSystems: ${systemList}\nNotes: ${notes || "None"}\n\nKind regards,\nCore Prescribing Solutions`.trim();

    const log = await insertRecord(HISTORY_MODEL, {
      entityType: normalizeEntityType(entityType), entityId: validatedId,
      type: "system_access",
      subject: `System Access Request — ${clinicianDetails.name} — ${systemList}`,
      notes: emailBody, date: new Date().toISOString(),
      time: new Date().toTimeString().slice(0, 5),
      starred: false, createdBy: req.user._id,
    });

    res.json({ message: "System access request logged successfully", log });
  } catch (err) {
    res.status(500).json({ message: "Failed to process system access request" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   MASS EMAIL
══════════════════════════════════════════════════════════════════ */
export const sendMassEmail = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { subject, body, recipients } = req.body;
    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!body?.trim())    return res.status(400).json({ message: "Body is required" });
    const valid = (recipients || []).filter(r => r.email?.includes("@"));
    if (!valid.length)    return res.status(400).json({ message: "At least one valid recipient email is required" });

    const validatedId = validateId(entityId, "entityId");
    const trackingId  = crypto.randomUUID();
    const apiBase     = `${req.protocol}://${req.get("host")}`;
    const pixel       = `<img src="${apiBase}/api/clients/track/${trackingId}" width="1" height="1" style="display:none;"/>`;

    const recipientResults = [];
    for (const r of valid) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM,
          to: r.name ? `"${r.name}" <${r.email}>` : r.email,
          subject, html: body + pixel,
        });
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      } catch (_) {
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      }
    }

    await insertRecord(HISTORY_MODEL, {
      entityType: normalizeEntityType(entityType), entityId: validatedId,
      type: "email",
      subject: `[Mass Email] ${subject}`,
      notes: body.replace(/<[^>]+>/g, "").slice(0, 500),
      date: new Date().toISOString(), time: new Date().toTimeString().slice(0, 5),
      isMassEmail: true, recipients: recipientResults,
      emailTracking: { sent: true, sentAt: new Date().toISOString(), trackingId },
      starred: false, createdBy: req.user._id,
    });

    res.json({ message: `Email sent to ${recipientResults.length} recipient(s)` });
  } catch (err) {
    res.status(500).json({ message: "Failed to send email" });
  }
};

export const trackEmailOpen = async (req, res) => {
  try {
    // Find history log with this trackingId and mark opened
    await query(
      `UPDATE app_records
       SET data = data || '{"emailTracking": {"opened": true}}'::jsonb
       WHERE model = $1
       AND data->'emailTracking'->>'trackingId' = $2`,
      [HISTORY_MODEL, req.params.trackingId]
    );
  } catch (_) {}
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-cache,no-store,must-revalidate" });
  res.end(pixel);
};

/* ══════════════════════════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════════════════════════ */
export const searchClients = async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ results: [] });

    const [icbs, pcns, practices] = await Promise.all([
      query(
        `SELECT id, data FROM app_records WHERE model = $1
         AND COALESCE((data->>'isActive')::boolean, true) = true
         AND data->>'name' ILIKE $2 LIMIT 5`,
        [ICB_MODEL, `%${q}%`]
      ).then(r => mapRows(r.rows).map(i => ({ ...i, _type: "icb" }))),

      query(
        `SELECT id, data FROM app_records WHERE model = $1
         AND COALESCE((data->>'isActive')::boolean, true) = true
         AND data->>'name' ILIKE $2 LIMIT 5`,
        [CLIENT_MODEL, `%${q}%`]
      ).then(r => mapRows(r.rows).map(p => ({ ...p, _type: "pcn" }))),

      query(
        `SELECT id, data FROM app_records WHERE model = $1
         AND COALESCE((data->>'isActive')::boolean, true) = true
         AND (data->>'name' ILIKE $2 OR data->>'odsCode' ILIKE $2) LIMIT 5`,
        [PRACTICE_MODEL, `%${q}%`]
      ).then(r => mapRows(r.rows).map(p => ({ ...p, _type: "practice" }))),
    ]);

    res.json({ results: [...icbs, ...pcns, ...practices] });
  } catch (err) {
    res.status(500).json({ message: "Search failed" });
  }
};