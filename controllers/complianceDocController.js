/**
 * complianceDocController.js
 * CRUD for ComplianceDocument and DocumentGroup admin management
 *
 * UPDATED (Apr 2026) — Spec: CPS_Controller_Update_Spec.docx
 *
 * createComplianceDoc    — +clinicianCanUpload, +visibleToClinician, +defaultReminderDays, +notes
 * updateComplianceDoc    — +clinicianCanUpload, +visibleToClinician, +defaultReminderDays, +notes
 * createDocumentGroup    — +applicableContractTypes, +colour, +notes
 * updateDocumentGroup    — +applicableContractTypes, +colour, +notes
 * getDocumentGroups      — +?applicableContractTypes= filter
 * duplicateDocumentGroup — copies applicableContractTypes + colour, does NOT copy notes
 *
 * Routes:
 *   GET    /api/compliance/documents
 *   GET    /api/compliance/documents/stats
 *   GET    /api/compliance/documents/:id
 *   POST   /api/compliance/documents
 *   PUT    /api/compliance/documents/:id
 *   DELETE /api/compliance/documents/:id
 *
 *   GET    /api/compliance/groups
 *   GET    /api/compliance/groups/:id
 *   POST   /api/compliance/groups
 *   PUT    /api/compliance/groups/:id
 *   DELETE /api/compliance/groups/:id
 *   GET    /api/compliance/groups/for-entity/:entityType
 *   POST   /api/compliance/groups/:id/duplicate
 */

import ComplianceDocument from "../models/ComplianceDocument.js";
import DocumentGroup      from "../models/DocumentGroup.js";

/* ══════════════════════════════════════════════
   COMPLIANCE DOCUMENTS
══════════════════════════════════════════════ */

/**
 * GET /api/compliance/documents
 * Query params:
 *   active, category, applicableTo, mandatory,
 *   expirable, autoSendOnBooking, preStartRequired, search
 */
export const getComplianceDocs = async (req, res) => {
  try {
    const {
      active, category, applicableTo, mandatory,
      expirable, autoSendOnBooking, preStartRequired, search,
    } = req.query;

    const filter = {};
    if (active             !== undefined) filter.active             = active === "true";
    if (mandatory          !== undefined) filter.mandatory          = mandatory === "true";
    if (expirable          !== undefined) filter.expirable          = expirable === "true";
    if (autoSendOnBooking  !== undefined) filter.autoSendOnBooking  = autoSendOnBooking === "true";
    if (preStartRequired   !== undefined) filter.preStartRequired   = preStartRequired === "true";
    if (category)     filter.category     = category;
    if (applicableTo) filter.applicableTo = applicableTo;

    if (search?.trim()) {
      filter.$or = [
        { name:        { $regex: search.trim(), $options: "i" } },
        { description: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const docs = await ComplianceDocument.find(filter)
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    res.json({ docs, total: docs.length });
  } catch (err) {
    console.error("getComplianceDocs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch compliance documents" });
  }
};

/**
 * GET /api/compliance/documents/stats
 */
export const getComplianceDocStats = async (req, res) => {
  try {
    const [total, active, mandatory, expirable, autoSend, preStart, byCategory] =
      await Promise.all([
        ComplianceDocument.countDocuments(),
        ComplianceDocument.countDocuments({ active: true }),
        ComplianceDocument.countDocuments({ mandatory: true }),
        ComplianceDocument.countDocuments({ expirable: true }),
        ComplianceDocument.countDocuments({ autoSendOnBooking: true }),
        ComplianceDocument.countDocuments({ preStartRequired: true }),
        ComplianceDocument.aggregate([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
      ]);

    res.json({
      total, active, inactive: total - active,
      mandatory, expirable, autoSend, preStart,
      byCategory: Object.fromEntries(byCategory.map((c) => [c._id, c.count])),
    });
  } catch (err) {
    console.error("getComplianceDocStats ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
};

/**
 * GET /api/compliance/documents/:id
 */
export const getComplianceDocById = async (req, res) => {
  try {
    const doc = await ComplianceDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: "Document not found" });

    const groups = await DocumentGroup.find({ documents: req.params.id })
      .select("name active displayOrder applicableEntityTypes")
      .lean();

    res.json({ doc, groups });
  } catch (err) {
    console.error("getComplianceDocById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document" });
  }
};

/**
 * POST /api/compliance/documents
 *
 * UPDATED: +clinicianCanUpload (bool, default true)
 *          +visibleToClinician  (bool, default true)
 *          +defaultReminderDays (number, default 28)
 *          +notes               (string, admin-only internal notes)
 */
export const createComplianceDoc = async (req, res) => {
  try {
    const {
      name, description, category, applicableTo, displayOrder,
      mandatory, expirable, active,
      defaultExpiryDays, reminderDays,
      autoSendOnBooking, preStartRequired,
      templateFileUrl, templateFileName,
      // ── NEW FIELDS (spec §1) ──────────────────────
      clinicianCanUpload,
      visibleToClinician,
      defaultReminderDays,
      notes,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Document name is required" });

    const exists = await ComplianceDocument.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ message: "A document with this name already exists" });

    const doc = await ComplianceDocument.create({
      name:              name.trim(),
      description:       description?.trim() || "",
      category:          category          ?? "other",
      applicableTo:      applicableTo      ?? ["Clinician"],
      displayOrder:      displayOrder      ?? 0,
      mandatory:         mandatory         ?? true,
      expirable:         expirable         ?? false,
      active:            active            ?? true,
      defaultExpiryDays: defaultExpiryDays ?? 365,
      reminderDays:      Array.isArray(reminderDays) ? reminderDays : [30, 14, 7, 0],
      autoSendOnBooking: autoSendOnBooking ?? false,
      preStartRequired:  preStartRequired  ?? false,
      templateFileUrl:   templateFileUrl   || "",
      templateFileName:  templateFileName  || "",
      // ── NEW FIELDS ───────────────────────────────
      clinicianCanUpload:  clinicianCanUpload  ?? true,
      visibleToClinician:  visibleToClinician  ?? true,
      defaultReminderDays: defaultReminderDays ?? 28,
      notes:               notes?.trim()       || "",
      createdBy: req.user._id,
    });

    res.status(201).json({ doc, message: "Compliance document created" });
  } catch (err) {
    console.error("createComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to create document" });
  }
};

/**
 * PUT /api/compliance/documents/:id
 *
 * UPDATED: +clinicianCanUpload, +visibleToClinician, +defaultReminderDays, +notes
 */
export const updateComplianceDoc = async (req, res) => {
  try {
    const {
      name, description, category, applicableTo, displayOrder,
      mandatory, expirable, active,
      defaultExpiryDays, reminderDays,
      autoSendOnBooking, preStartRequired,
      templateFileUrl, templateFileName,
      // ── NEW FIELDS (spec §2) ──────────────────────
      clinicianCanUpload,
      visibleToClinician,
      defaultReminderDays,
      notes,
    } = req.body;

    const updateFields = {
      ...(name                !== undefined && { name: name.trim() }),
      ...(description         !== undefined && { description: description.trim() }),
      ...(category            !== undefined && { category }),
      ...(applicableTo        !== undefined && { applicableTo }),
      ...(displayOrder        !== undefined && { displayOrder }),
      ...(mandatory           !== undefined && { mandatory }),
      ...(expirable           !== undefined && { expirable }),
      ...(active              !== undefined && { active }),
      ...(defaultExpiryDays   !== undefined && { defaultExpiryDays }),
      ...(reminderDays        !== undefined && { reminderDays }),
      ...(autoSendOnBooking   !== undefined && { autoSendOnBooking }),
      ...(preStartRequired    !== undefined && { preStartRequired }),
      ...(templateFileUrl     !== undefined && { templateFileUrl }),
      ...(templateFileName    !== undefined && { templateFileName }),
      // ── NEW FIELDS ───────────────────────────────
      ...(clinicianCanUpload  !== undefined && { clinicianCanUpload }),
      ...(visibleToClinician  !== undefined && { visibleToClinician }),
      ...(defaultReminderDays !== undefined && { defaultReminderDays }),
      ...(notes               !== undefined && { notes: notes?.trim() || "" }),
      updatedBy: req.user._id,
    };

    const doc = await ComplianceDocument.findByIdAndUpdate(
      req.params.id, updateFields,
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: "Document not found" });

    res.json({ doc, message: "Document updated" });
  } catch (err) {
    console.error("updateComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document" });
  }
};

/**
 * DELETE /api/compliance/documents/:id
 */
export const deleteComplianceDoc = async (req, res) => {
  try {
    await DocumentGroup.updateMany(
      { documents: req.params.id },
      { $pull: { documents: req.params.id } }
    );
    const doc = await ComplianceDocument.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    res.json({ message: "Document deleted and removed from all groups" });
  } catch (err) {
    console.error("deleteComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete document" });
  }
};

/* ══════════════════════════════════════════════
   DOCUMENT GROUPS
══════════════════════════════════════════════ */

/**
 * GET /api/compliance/groups
 * Query params: active, applicableEntityTypes, autoAssignOnBooking,
 *               isPreStartChecklist, applicableContractTypes (NEW)
 *
 * UPDATED: +?applicableContractTypes= filter (spec §5)
 *   e.g. /api/compliance/groups?applicableContractTypes=ARRS
 *        returns only groups where applicableContractTypes includes "ARRS"
 */
export const getDocumentGroups = async (req, res) => {
  try {
    const {
      active, applicableEntityTypes, autoAssignOnBooking,
      isPreStartChecklist,
      applicableContractTypes, // ── NEW FILTER (spec §5)
    } = req.query;

    const filter = {};
    if (active                !== undefined) filter.active                = active === "true";
    if (autoAssignOnBooking   !== undefined) filter.autoAssignOnBooking   = autoAssignOnBooking === "true";
    if (isPreStartChecklist   !== undefined) filter.isPreStartChecklist   = isPreStartChecklist === "true";
    if (applicableEntityTypes) filter.applicableEntityTypes = applicableEntityTypes;

    // ── NEW: filter by contract type ─────────────────
    // Supports comma-separated: ?applicableContractTypes=ARRS,EA
    if (applicableContractTypes) {
      const types = String(applicableContractTypes)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length === 1) {
        filter.applicableContractTypes = types[0];
      } else if (types.length > 1) {
        filter.applicableContractTypes = { $in: types };
      }
    }

    const groups = await DocumentGroup.find(filter)
      .populate("documents", "name displayOrder mandatory expirable active category autoSendOnBooking preStartRequired")
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    res.json({ groups, total: groups.length });
  } catch (err) {
    console.error("getDocumentGroups ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document groups" });
  }
};

/**
 * GET /api/compliance/groups/for-entity/:entityType
 */
export const getGroupsForEntity = async (req, res) => {
  try {
    const { entityType } = req.params;
    const groups = await DocumentGroup.find({
      active: true,
      applicableEntityTypes: entityType,
    })
      .populate("documents", "name displayOrder mandatory expirable active category reminderDays autoSendOnBooking preStartRequired")
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    res.json({ groups, total: groups.length });
  } catch (err) {
    console.error("getGroupsForEntity ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch groups for entity" });
  }
};

/**
 * GET /api/compliance/groups/:id
 */
export const getDocumentGroupById = async (req, res) => {
  try {
    const group = await DocumentGroup.findById(req.params.id)
      .populate("documents", "name displayOrder mandatory expirable active category defaultExpiryDays reminderDays autoSendOnBooking preStartRequired")
      .lean();
    if (!group) return res.status(404).json({ message: "Document group not found" });

    const allDocs = await ComplianceDocument.find({ active: true })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    res.json({ group, allDocs });
  } catch (err) {
    console.error("getDocumentGroupById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch group" });
  }
};

/**
 * POST /api/compliance/groups
 *
 * UPDATED: +applicableContractTypes (array, e.g. ['ARRS','EA'])
 *          +colour                  (string, UI badge hex/name)
 *          +notes                   (string, admin internal notes)
 */
export const createDocumentGroup = async (req, res) => {
  try {
    const {
      name, description, displayOrder, active,
      applicableEntityTypes, documents,
      isPreStartChecklist, autoAssignOnBooking,
      // ── NEW FIELDS (spec §3) ──────────────────────
      applicableContractTypes,
      colour,
      notes,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Group name is required" });

    const exists = await DocumentGroup.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ message: "A group with this name already exists" });

    const group = await DocumentGroup.create({
      name:                  name.trim(),
      description:           description?.trim()  || "",
      displayOrder:          displayOrder          ?? 0,
      active:                active                ?? true,
      applicableEntityTypes: applicableEntityTypes ?? ["Clinician"],
      documents:             documents             || [],
      isPreStartChecklist:   isPreStartChecklist   ?? false,
      autoAssignOnBooking:   autoAssignOnBooking   ?? false,
      // ── NEW FIELDS ───────────────────────────────
      applicableContractTypes: Array.isArray(applicableContractTypes) ? applicableContractTypes : [],
      colour:                  colour?.trim() || "",
      notes:                   notes?.trim()  || "",
      createdBy: req.user._id,
    });

    const populated = await DocumentGroup.findById(group._id)
      .populate("documents", "name displayOrder mandatory expirable active category")
      .lean();

    res.status(201).json({ group: populated, message: "Document group created" });
  } catch (err) {
    console.error("createDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to create document group" });
  }
};

/**
 * PUT /api/compliance/groups/:id
 *
 * UPDATED: +applicableContractTypes, +colour, +notes
 */
export const updateDocumentGroup = async (req, res) => {
  try {
    const {
      name, description, displayOrder, active,
      applicableEntityTypes, documents,
      isPreStartChecklist, autoAssignOnBooking,
      // ── NEW FIELDS (spec §4) ──────────────────────
      applicableContractTypes,
      colour,
      notes,
    } = req.body;

    const updateFields = {
      ...(name                    !== undefined && { name: name.trim() }),
      ...(description             !== undefined && { description: description.trim() }),
      ...(displayOrder            !== undefined && { displayOrder }),
      ...(active                  !== undefined && { active }),
      ...(applicableEntityTypes   !== undefined && { applicableEntityTypes }),
      ...(documents               !== undefined && { documents }),
      ...(isPreStartChecklist     !== undefined && { isPreStartChecklist }),
      ...(autoAssignOnBooking     !== undefined && { autoAssignOnBooking }),
      // ── NEW FIELDS ───────────────────────────────
      ...(applicableContractTypes !== undefined && { applicableContractTypes }),
      ...(colour                  !== undefined && { colour: colour?.trim() || "" }),
      ...(notes                   !== undefined && { notes: notes?.trim() || "" }),
      updatedBy: req.user._id,
    };

    const group = await DocumentGroup.findByIdAndUpdate(
      req.params.id, updateFields,
      { new: true, runValidators: true }
    ).populate("documents", "name displayOrder mandatory expirable active category");

    if (!group) return res.status(404).json({ message: "Document group not found" });

    res.json({ group, message: "Document group updated" });
  } catch (err) {
    console.error("updateDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document group" });
  }
};

/**
 * DELETE /api/compliance/groups/:id
 */
export const deleteDocumentGroup = async (req, res) => {
  try {
    const group = await DocumentGroup.findByIdAndDelete(req.params.id);
    if (!group) return res.status(404).json({ message: "Document group not found" });
    res.json({ message: "Document group deleted" });
  } catch (err) {
    console.error("deleteDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete document group" });
  }
};

/**
 * POST /api/compliance/groups/:id/duplicate
 *
 * UPDATED: copies applicableContractTypes + colour from source
 *          does NOT copy notes (spec §6 — admin adds fresh notes to clone)
 */
export const duplicateDocumentGroup = async (req, res) => {
  try {
    const source = await DocumentGroup.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ message: "Document group not found" });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "New group name is required" });

    const already = await DocumentGroup.findOne({ name: name.trim() });
    if (already) return res.status(409).json({ message: "A group with this name already exists" });

    const copy = await DocumentGroup.create({
      name:                  name.trim(),
      description:           source.description,
      displayOrder:          source.displayOrder,
      active:                true,
      applicableEntityTypes: source.applicableEntityTypes,
      documents:             source.documents,
      isPreStartChecklist:   source.isPreStartChecklist,
      autoAssignOnBooking:   source.autoAssignOnBooking,
      // ── NEW FIELDS: copy contract types + colour, NOT notes (spec §6) ──
      applicableContractTypes: source.applicableContractTypes || [],
      colour:                  source.colour || "",
      notes:                   "",          // intentionally blank on clone
      createdBy: req.user._id,
    });

    const populated = await DocumentGroup.findById(copy._id)
      .populate("documents", "name displayOrder mandatory expirable active category")
      .lean();

    res.status(201).json({ group: populated, message: "Group duplicated successfully" });
  } catch (err) {
    console.error("duplicateDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to duplicate group" });
  }
};