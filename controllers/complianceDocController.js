/**
 * complianceDocController.js
 * CRUD for ComplianceDocument and DocumentGroup admin management
 * Routes:
 *   GET    /api/compliance/documents
 *   POST   /api/compliance/documents
 *   PUT    /api/compliance/documents/:id
 *   DELETE /api/compliance/documents/:id
 *
 *   GET    /api/compliance/groups
 *   POST   /api/compliance/groups
 *   GET    /api/compliance/groups/:id
 *   PUT    /api/compliance/groups/:id
 *   DELETE /api/compliance/groups/:id
 */

import ComplianceDocument from "../models/ComplianceDocument.js";
import DocumentGroup      from "../models/DocumentGroup.js";

/* ══════════════════════════════════════════════
   COMPLIANCE DOCUMENTS
══════════════════════════════════════════════ */

export const getComplianceDocs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = req.query.active === "true";
    const docs = await ComplianceDocument.find(filter)
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    res.json({ docs, total: docs.length });
  } catch (err) {
    console.error("getComplianceDocs ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch compliance documents" });
  }
};

export const getComplianceDocById = async (req, res) => {
  try {
    const doc = await ComplianceDocument.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: "Document not found" });
    // Populate which groups this doc belongs to
    const groups = await DocumentGroup.find({ documents: req.params.id })
      .select("name active displayOrder")
      .lean();
    res.json({ doc, groups });
  } catch (err) {
    console.error("getComplianceDocById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document" });
  }
};

export const createComplianceDoc = async (req, res) => {
  try {
    const { name, displayOrder, mandatory, expirable, active, defaultExpiryDays, defaultReminderDays } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Document name is required" });

    const exists = await ComplianceDocument.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ message: "A document with this name already exists" });

    const doc = await ComplianceDocument.create({
      name: name.trim(),
      displayOrder: displayOrder ?? 0,
      mandatory:    mandatory ?? true,
      expirable:    expirable ?? false,
      active:       active    ?? true,
      defaultExpiryDays:  defaultExpiryDays  ?? 365,
      defaultReminderDays: defaultReminderDays ?? 28,
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
    const { name, displayOrder, mandatory, expirable, active, defaultExpiryDays, defaultReminderDays } = req.body;
    const doc = await ComplianceDocument.findByIdAndUpdate(
      req.params.id,
      {
        ...(name               !== undefined && { name: name.trim() }),
        ...(displayOrder       !== undefined && { displayOrder }),
        ...(mandatory          !== undefined && { mandatory }),
        ...(expirable          !== undefined && { expirable }),
        ...(active             !== undefined && { active }),
        ...(defaultExpiryDays  !== undefined && { defaultExpiryDays }),
        ...(defaultReminderDays!== undefined && { defaultReminderDays }),
      },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ message: "Document not found" });
    res.json({ doc, message: "Document updated" });
  } catch (err) {
    console.error("updateComplianceDoc ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document" });
  }
};

export const deleteComplianceDoc = async (req, res) => {
  try {
    // Remove from all groups first
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

export const getDocumentGroups = async (req, res) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = req.query.active === "true";
    const groups = await DocumentGroup.find(filter)
      .populate("documents", "name displayOrder mandatory expirable active")
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    res.json({ groups, total: groups.length });
  } catch (err) {
    console.error("getDocumentGroups ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch document groups" });
  }
};

export const getDocumentGroupById = async (req, res) => {
  try {
    const group = await DocumentGroup.findById(req.params.id)
      .populate("documents", "name displayOrder mandatory expirable active defaultExpiryDays defaultReminderDays")
      .lean();
    if (!group) return res.status(404).json({ message: "Document group not found" });
    // All available docs for the checkbox list
    const allDocs = await ComplianceDocument.find({ active: true })
      .sort({ displayOrder: 1, name: 1 })
      .lean();
    res.json({ group, allDocs });
  } catch (err) {
    console.error("getDocumentGroupById ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch group" });
  }
};

export const createDocumentGroup = async (req, res) => {
  try {
    const { name, displayOrder, active, documents } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Group name is required" });

    const exists = await DocumentGroup.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ message: "A group with this name already exists" });

    const group = await DocumentGroup.create({
      name: name.trim(),
      displayOrder: displayOrder ?? 0,
      active:       active       ?? true,
      documents:    documents    || [],
      createdBy: req.user._id,
    });

    const populated = await DocumentGroup.findById(group._id)
      .populate("documents", "name displayOrder mandatory expirable active")
      .lean();

    res.status(201).json({ group: populated, message: "Document group created" });
  } catch (err) {
    console.error("createDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to create document group" });
  }
};

export const updateDocumentGroup = async (req, res) => {
  try {
    const { name, displayOrder, active, documents } = req.body;
    const group = await DocumentGroup.findByIdAndUpdate(
      req.params.id,
      {
        ...(name         !== undefined && { name: name.trim() }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(active       !== undefined && { active }),
        ...(documents    !== undefined && { documents }),
      },
      { new: true, runValidators: true }
    ).populate("documents", "name displayOrder mandatory expirable active");

    if (!group) return res.status(404).json({ message: "Document group not found" });
    res.json({ group, message: "Document group updated" });
  } catch (err) {
    console.error("updateDocumentGroup ERROR:", err.message);
    res.status(500).json({ message: "Failed to update document group" });
  }
};

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