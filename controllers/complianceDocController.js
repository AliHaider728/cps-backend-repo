/**
 * complianceDocController.js
 * CONVERTED TO POSTGRESQL (Apr 2026)
 *
 * Data stored in app_records:
 *   model = "compliance_document" → ComplianceDocuments
 *   model = "document_group"      → DocumentGroups
 */

import { v4 as uuidv4 } from "uuid";
import { query }          from "../config/db.js";

const COMP_DOC_MODEL  = "compliance_document";
const DOC_GROUP_MODEL = "document_group";

/* ── DB Helpers ─────────────────────────────────────────────────── */
function mapRow(row) {
  if (!row) return null;
  return {
    _id: row.id, id: row.id,
    ...(row.data || {}),
    createdAt: row.data?.createdAt || row.created_at?.toISOString?.() || null,
    updatedAt: row.data?.updatedAt || row.updated_at?.toISOString?.() || null,
  };
}
function mapRows(rows) { return (rows || []).map(mapRow).filter(Boolean); }

async function findById(model, id) {
  if (!id) return null;
  const r = await query(
    `SELECT id, data, created_at, updated_at FROM app_records WHERE model = $1 AND id = $2 LIMIT 1`,
    [model, id]
  );
  return mapRow(r.rows[0]);
}

async function insertRecord(model, payload) {
  const id        = uuidv4();
  const timestamp = new Date().toISOString();
  const data      = { ...payload, createdAt: timestamp, updatedAt: timestamp };
  const r         = await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW()) RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRow(r.rows[0]);
}

async function updateRecord(model, id, patch) {
  const data = { ...patch, updatedAt: new Date().toISOString() };
  const r    = await query(
    `UPDATE app_records SET data = COALESCE(data,'{}':jsonb) || $3::jsonb, updated_at = NOW()
     WHERE model = $1 AND id = $2 RETURNING id, data, created_at, updated_at`,
    [model, id, JSON.stringify(data)]
  );
  return mapRow(r.rows[0]);
}

async function deleteRecord(model, id) {
  const r = await query(
    `DELETE FROM app_records WHERE model = $1 AND id = $2 RETURNING id`,
    [model, id]
  );
  return r.rows[0] || null;
}

/* ── Populate documents into a group ─────────────────────────────── */
async function populateGroupDocs(group, selectFields = null) {
  if (!group) return group;
  const docIds = Array.isArray(group.documents) ? group.documents : [];
  const docs   = [];
  for (const dId of docIds) {
    const docId = dId?._id || dId?.id || dId;
    if (!docId) continue;
    const doc = await findById(COMP_DOC_MODEL, String(docId));
    if (doc) docs.push(doc);
  }
  return { ...group, documents: docs };
}

/* ══════════════════════════════════════════════════════════════════
   COMPLIANCE DOCUMENTS
══════════════════════════════════════════════════════════════════ */
export const getComplianceDocs = async (req, res) => {
  try {
    const {
      active, category, applicableTo, mandatory,
      expirable, autoSendOnBooking, preStartRequired, search,
    } = req.query;

    const conditions = [`model = $1`];
    const params     = [COMP_DOC_MODEL];
    let   idx        = 2;

    if (active            !== undefined) { conditions.push(`(data->>'active')::boolean = $${idx++}`); params.push(active === "true"); }
    if (mandatory         !== undefined) { conditions.push(`(data->>'mandatory')::boolean = $${idx++}`); params.push(mandatory === "true"); }
    if (expirable         !== undefined) { conditions.push(`(data->>'expirable')::boolean = $${idx++}`); params.push(expirable === "true"); }
    if (autoSendOnBooking !== undefined) { conditions.push(`(data->>'autoSendOnBooking')::boolean = $${idx++}`); params.push(autoSendOnBooking === "true"); }
    if (preStartRequired  !== undefined) { conditions.push(`(data->>'preStartRequired')::boolean = $${idx++}`); params.push(preStartRequired === "true"); }
    if (category)    { conditions.push(`data->>'category' = $${idx++}`);    params.push(category); }
    if (applicableTo){ conditions.push(`data->'applicableTo' @> $${idx++}::jsonb`); params.push(JSON.stringify([applicableTo])); }
    if (search?.trim()) {
      conditions.push(`(data->>'name' ILIKE $${idx} OR data->>'description' ILIKE $${idx})`);
      params.push(`%${search.trim()}%`); idx++;
    }

    const r    = await query(
      `SELECT id, data, created_at, updated_at FROM app_records WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE((data->>'displayOrder')::int, 0) ASC, data->>'name' ASC`,
      params
    );
    const docs = mapRows(r.rows);
    res.json({ docs, total: docs.length });
  } catch (err) {
    console.error("getComplianceDocs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch compliance documents" });
  }
};

export const getComplianceDocStats = async (req, res) => {
  try {
    const [total, active, mandatory, expirable, autoSend, preStart] = await Promise.all([
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1 AND (data->>'active')::boolean = true`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1 AND (data->>'mandatory')::boolean = true`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1 AND (data->>'expirable')::boolean = true`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1 AND (data->>'autoSendOnBooking')::boolean = true`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
      query(`SELECT COUNT(*) FROM app_records WHERE model = $1 AND (data->>'preStartRequired')::boolean = true`, [COMP_DOC_MODEL]).then(r => parseInt(r.rows[0].count)),
    ]);

    // Category counts
    const catResult  = await query(
      `SELECT data->>'category' AS cat, COUNT(*) FROM app_records WHERE model = $1 GROUP BY cat`,
      [COMP_DOC_MODEL]
    );
    const byCategory = Object.fromEntries(catResult.rows.map(r => [r.cat, parseInt(r.count)]));

    res.json({ total, active, inactive: total - active, mandatory, expirable, autoSend, preStart, byCategory });
  } catch (err) {
    console.error("getComplianceDocStats ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
};

export const getComplianceDocById = async (req, res) => {
  try {
    const doc = await findById(COMP_DOC_MODEL, req.params.id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    // Find groups that contain this document
    const groupsResult = await query(
      `SELECT id, data FROM app_records WHERE model = $1 AND data->'documents' @> $2::jsonb`,
      [DOC_GROUP_MODEL, JSON.stringify([req.params.id])]
    );
    const groups = mapRows(groupsResult.rows);

    res.json({ doc, groups });
  } catch (err) {
    console.error("getComplianceDocById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document" });
  }
};

export const createComplianceDoc = async (req, res) => {
  try {
    const {
      name, description, category, applicableTo, displayOrder,
      mandatory, expirable, active, defaultExpiryDays, reminderDays,
      autoSendOnBooking, preStartRequired, templateFileUrl, templateFileName,
      clinicianCanUpload, visibleToClinician, defaultReminderDays, notes,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Document name is required" });

    // Duplicate check
    const existing = await query(
      `SELECT id FROM app_records WHERE model = $1 AND LOWER(data->>'name') = LOWER($2) LIMIT 1`,
      [COMP_DOC_MODEL, name.trim()]
    );
    if (existing.rows.length) return res.status(409).json({ message: "A document with this name already exists" });

    const doc = await insertRecord(COMP_DOC_MODEL, {
      name:              name.trim(),
      description:       description?.trim() || "",
      category:          category          ?? "other",
      applicableTo:      applicableTo      ?? ["Clinician"],
      displayOrder:      displayOrder      ?? 0,
      mandatory:         mandatory         ?? true,
      expirable:         expirable         ?? false,
      active:            active            ?? true,
      defaultExpiryDays: defaultExpiryDays ?? 365,
      defaultReminderDays: defaultReminderDays ?? 28,
      reminderDays:      Array.isArray(reminderDays) ? reminderDays : [30, 14, 7, 0],
      autoSendOnBooking: autoSendOnBooking ?? false,
      preStartRequired:  preStartRequired  ?? false,
      templateFileUrl:   templateFileUrl   || "",
      templateFileName:  templateFileName  || "",
      clinicianCanUpload:  clinicianCanUpload  ?? true,
      visibleToClinician:  visibleToClinician  ?? true,
      notes:               notes?.trim()       || "",
      createdBy: req.user._id,
    });

    res.status(201).json({ doc, message: "Compliance document created" });
  } catch (err) {
    console.error("createComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to create document" });
  }
};

export const updateComplianceDoc = async (req, res) => {
  try {
    const doc = await findById(COMP_DOC_MODEL, req.params.id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    const {
      name, description, category, applicableTo, displayOrder,
      mandatory, expirable, active, defaultExpiryDays, reminderDays,
      autoSendOnBooking, preStartRequired, templateFileUrl, templateFileName,
      clinicianCanUpload, visibleToClinician, defaultReminderDays, notes,
    } = req.body;

    const patch = {
      ...(name                !== undefined && { name: name.trim() }),
      ...(description         !== undefined && { description: description.trim() }),
      ...(category            !== undefined && { category }),
      ...(applicableTo        !== undefined && { applicableTo }),
      ...(displayOrder        !== undefined && { displayOrder }),
      ...(mandatory           !== undefined && { mandatory }),
      ...(expirable           !== undefined && { expirable }),
      ...(active              !== undefined && { active }),
      ...(defaultExpiryDays   !== undefined && { defaultExpiryDays }),
      ...(defaultReminderDays !== undefined && { defaultReminderDays }),
      ...(reminderDays        !== undefined && { reminderDays }),
      ...(autoSendOnBooking   !== undefined && { autoSendOnBooking }),
      ...(preStartRequired    !== undefined && { preStartRequired }),
      ...(templateFileUrl     !== undefined && { templateFileUrl }),
      ...(templateFileName    !== undefined && { templateFileName }),
      ...(clinicianCanUpload  !== undefined && { clinicianCanUpload }),
      ...(visibleToClinician  !== undefined && { visibleToClinician }),
      ...(notes               !== undefined && { notes: notes?.trim() || "" }),
      updatedBy: req.user._id,
    };

    const updated = await updateRecord(COMP_DOC_MODEL, req.params.id, patch);
    res.json({ doc: updated, message: "Document updated" });
  } catch (err) {
    console.error("updateComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document" });
  }
};

export const deleteComplianceDoc = async (req, res) => {
  try {
    // Remove from all groups that contain this doc
    const groupsResult = await query(
      `SELECT id, data FROM app_records WHERE model = $1 AND data->'documents' @> $2::jsonb`,
      [DOC_GROUP_MODEL, JSON.stringify([req.params.id])]
    );
    const groups = mapRows(groupsResult.rows);
    for (const g of groups) {
      const newDocs = (g.documents || []).filter(d => {
        const dId = d?._id || d?.id || d;
        return String(dId) !== String(req.params.id);
      });
      await updateRecord(DOC_GROUP_MODEL, g._id, { documents: newDocs });
    }

    const deleted = await deleteRecord(COMP_DOC_MODEL, req.params.id);
    if (!deleted) return res.status(404).json({ message: "Document not found" });
    res.json({ message: "Document deleted and removed from all groups" });
  } catch (err) {
    console.error("deleteComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete document" });
  }
};

/* ══════════════════════════════════════════════════════════════════
   DOCUMENT GROUPS
══════════════════════════════════════════════════════════════════ */
export const getDocumentGroups = async (req, res) => {
  try {
    const {
      active, applicableEntityTypes, autoAssignOnBooking,
      isPreStartChecklist, applicableContractTypes,
    } = req.query;

    const conditions = [`model = $1`];
    const params     = [DOC_GROUP_MODEL];
    let   idx        = 2;

    if (active              !== undefined) { conditions.push(`(data->>'active')::boolean = $${idx++}`); params.push(active === "true"); }
    if (autoAssignOnBooking !== undefined) { conditions.push(`(data->>'autoAssignOnBooking')::boolean = $${idx++}`); params.push(autoAssignOnBooking === "true"); }
    if (isPreStartChecklist !== undefined) { conditions.push(`(data->>'isPreStartChecklist')::boolean = $${idx++}`); params.push(isPreStartChecklist === "true"); }
    if (applicableEntityTypes) {
      conditions.push(`data->'applicableEntityTypes' @> $${idx++}::jsonb`);
      params.push(JSON.stringify([applicableEntityTypes]));
    }
    if (applicableContractTypes) {
      const types = String(applicableContractTypes).split(",").map(t => t.trim()).filter(Boolean);
      if (types.length) {
        conditions.push(`data->'applicableContractTypes' @> $${idx++}::jsonb`);
        params.push(JSON.stringify([types[0]]));
      }
    }

    const r      = await query(
      `SELECT id, data, created_at, updated_at FROM app_records WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE((data->>'displayOrder')::int, 0) ASC, data->>'name' ASC`,
      params
    );
    const groups = mapRows(r.rows);

    // Populate documents for each group
    const populated = await Promise.all(groups.map(g => populateGroupDocs(g)));
    res.json({ groups: populated, total: populated.length });
  } catch (err) {
    console.error("getDocumentGroups ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document groups" });
  }
};

export const getGroupsForEntity = async (req, res) => {
  try {
    const { entityType } = req.params;
    const r = await query(
      `SELECT id, data, created_at, updated_at FROM app_records
       WHERE model = $1
       AND (data->>'active')::boolean = true
       AND data->'applicableEntityTypes' @> $2::jsonb
       ORDER BY COALESCE((data->>'displayOrder')::int, 0) ASC, data->>'name' ASC`,
      [DOC_GROUP_MODEL, JSON.stringify([entityType])]
    );
    const groups    = mapRows(r.rows);
    const populated = await Promise.all(groups.map(g => populateGroupDocs(g)));
    res.json({ groups: populated, total: populated.length });
  } catch (err) {
    console.error("getGroupsForEntity ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch groups for entity" });
  }
};

export const getDocumentGroupById = async (req, res) => {
  try {
    const group = await findById(DOC_GROUP_MODEL, req.params.id);
    if (!group) return res.status(404).json({ message: "Document group not found" });

    const populated = await populateGroupDocs(group);

    // All active compliance docs
    const allDocsResult = await query(
      `SELECT id, data FROM app_records WHERE model = $1
       AND COALESCE((data->>'active')::boolean, true) = true
       ORDER BY COALESCE((data->>'displayOrder')::int, 0) ASC, data->>'name' ASC`,
      [COMP_DOC_MODEL]
    );
    const allDocs = mapRows(allDocsResult.rows);

    res.json({ group: populated, allDocs });
  } catch (err) {
    console.error("getDocumentGroupById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch group" });
  }
};

export const createDocumentGroup = async (req, res) => {
  try {
    const {
      name, description, displayOrder, active,
      applicableEntityTypes, documents,
      isPreStartChecklist, autoAssignOnBooking,
      applicableContractTypes, colour, notes,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Group name is required" });

    const existing = await query(
      `SELECT id FROM app_records WHERE model = $1 AND LOWER(data->>'name') = LOWER($2) LIMIT 1`,
      [DOC_GROUP_MODEL, name.trim()]
    );
    if (existing.rows.length) return res.status(409).json({ message: "A group with this name already exists" });

    // Store document IDs only
    const docIds = (documents || []).map(d => d?._id || d?.id || d).filter(Boolean);

    const group = await insertRecord(DOC_GROUP_MODEL, {
      name:                  name.trim(),
      description:           description?.trim()  || "",
      displayOrder:          displayOrder          ?? 0,
      active:                active                ?? true,
      applicableEntityTypes: applicableEntityTypes ?? ["Clinician"],
      documents:             docIds,
      isPreStartChecklist:   isPreStartChecklist   ?? false,
      autoAssignOnBooking:   autoAssignOnBooking   ?? false,
      applicableContractTypes: Array.isArray(applicableContractTypes) ? applicableContractTypes : [],
      colour:                colour?.trim() || "",
      notes:                 notes?.trim()  || "",
      createdBy: req.user._id,
    });

    const populated = await populateGroupDocs(group);
    res.status(201).json({ group: populated, message: "Document group created" });
  } catch (err) {
    console.error("createDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to create document group" });
  }
};

export const updateDocumentGroup = async (req, res) => {
  try {
    const group = await findById(DOC_GROUP_MODEL, req.params.id);
    if (!group) return res.status(404).json({ message: "Document group not found" });

    const {
      name, description, displayOrder, active,
      applicableEntityTypes, documents,
      isPreStartChecklist, autoAssignOnBooking,
      applicableContractTypes, colour, notes,
    } = req.body;

    // Store document IDs only
    let docIds;
    if (documents !== undefined) {
      docIds = documents.map(d => d?._id || d?.id || d).filter(Boolean);
    }

    const patch = {
      ...(name                    !== undefined && { name: name.trim() }),
      ...(description             !== undefined && { description: description.trim() }),
      ...(displayOrder            !== undefined && { displayOrder }),
      ...(active                  !== undefined && { active }),
      ...(applicableEntityTypes   !== undefined && { applicableEntityTypes }),
      ...(documents               !== undefined && { documents: docIds }),
      ...(isPreStartChecklist     !== undefined && { isPreStartChecklist }),
      ...(autoAssignOnBooking     !== undefined && { autoAssignOnBooking }),
      ...(applicableContractTypes !== undefined && { applicableContractTypes }),
      ...(colour                  !== undefined && { colour: colour?.trim() || "" }),
      ...(notes                   !== undefined && { notes: notes?.trim() || "" }),
      updatedBy: req.user._id,
    };

    const updated   = await updateRecord(DOC_GROUP_MODEL, req.params.id, patch);
    const populated = await populateGroupDocs(updated);
    res.json({ group: populated, message: "Document group updated" });
  } catch (err) {
    console.error("updateDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document group" });
  }
};

export const deleteDocumentGroup = async (req, res) => {
  try {
    const deleted = await deleteRecord(DOC_GROUP_MODEL, req.params.id);
    if (!deleted) return res.status(404).json({ message: "Document group not found" });
    res.json({ message: "Document group deleted" });
  } catch (err) {
    console.error("deleteDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete document group" });
  }
};

export const duplicateDocumentGroup = async (req, res) => {
  try {
    const source = await findById(DOC_GROUP_MODEL, req.params.id);
    if (!source) return res.status(404).json({ message: "Document group not found" });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "New group name is required" });

    const already = await query(
      `SELECT id FROM app_records WHERE model = $1 AND LOWER(data->>'name') = LOWER($2) LIMIT 1`,
      [DOC_GROUP_MODEL, name.trim()]
    );
    if (already.rows.length) return res.status(409).json({ message: "A group with this name already exists" });

    const docIds = (source.documents || []).map(d => d?._id || d?.id || d).filter(Boolean);

    const copy = await insertRecord(DOC_GROUP_MODEL, {
      name:                  name.trim(),
      description:           source.description   || "",
      displayOrder:          source.displayOrder   ?? 0,
      active:                true,
      applicableEntityTypes: source.applicableEntityTypes || [],
      documents:             docIds,
      isPreStartChecklist:   source.isPreStartChecklist   ?? false,
      autoAssignOnBooking:   source.autoAssignOnBooking   ?? false,
      applicableContractTypes: source.applicableContractTypes || [],
      colour:                source.colour || "",
      notes:                 "",  // intentionally blank on clone
      createdBy: req.user._id,
    });

    const populated = await populateGroupDocs(copy);
    res.status(201).json({ group: populated, message: "Group duplicated successfully" });
  } catch (err) {
    console.error("duplicateDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to duplicate group" });
  }
};