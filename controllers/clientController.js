import ICB           from "../models/ICB.js";
import PCN           from "../models/PCN.js";
import Practice      from "../models/Practice.js";
import ContactHistory from "../models/ContactHistory.js";
import { logAudit }  from "../middleware/auditLogger.js";
import nodemailer    from "nodemailer";
import crypto        from "crypto";

// ── Email transporter  
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});


//  ICB CRUD


export const getICBs = async (req, res) => {
  try {
    const icbs = await ICB.find().sort({ name: 1 });
    res.json({ success: true, icbs });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createICB = async (req, res) => {
  try {
    const { name, region, notes } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });
    const icb = await ICB.create({ name, region, notes, createdBy: req.user._id });
    await logAudit(req, "CREATE_ICB", "ICB", { resourceId: icb._id, detail: `Created ICB: ${icb.name}` });
    res.status(201).json({ success: true, icb });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updateICB = async (req, res) => {
  try {
    const icb = await ICB.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!icb) return res.status(404).json({ message: "ICB not found" });
    await logAudit(req, "UPDATE_ICB", "ICB", { resourceId: icb._id, detail: `Updated ICB: ${icb.name}` });
    res.json({ success: true, icb });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const deleteICB = async (req, res) => {
  try {
    const icb = await ICB.findByIdAndDelete(req.params.id);
    if (!icb) return res.status(404).json({ message: "ICB not found" });
    await logAudit(req, "DELETE_ICB", "ICB", { resourceId: req.params.id, detail: `Deleted ICB: ${icb.name}` });
    res.json({ success: true, message: "ICB deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


//  PCN CRUD


export const getPCNs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.icb) filter.icb = req.query.icb;
    const pcns = await PCN.find(filter).populate("icb", "name region").sort({ name: 1 });
    res.json({ success: true, pcns });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getPCNById = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region")
      .populate("restrictedClinicians", "name email role");
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    const practices = await Practice.find({ pcn: pcn._id }).select("name odsCode isActive");
    res.json({ success: true, pcn, practices });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createPCN = async (req, res) => {
  try {
    const { name, icb, federation, contacts, annualSpend, notes } = req.body;
    if (!name || !icb) return res.status(400).json({ message: "Name and ICB are required" });
    const pcn = await PCN.create({ name, icb, federation, contacts, annualSpend, notes, createdBy: req.user._id });
    await logAudit(req, "CREATE_PCN", "PCN", { resourceId: pcn._id, detail: `Created PCN: ${pcn.name}` });
    res.status(201).json({ success: true, pcn });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updatePCN = async (req, res) => {
  try {
    const pcn = await PCN.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    await logAudit(req, "UPDATE_PCN", "PCN", { resourceId: pcn._id, detail: `Updated PCN: ${pcn.name}` });
    res.json({ success: true, pcn });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const deletePCN = async (req, res) => {
  try {
    const pcn = await PCN.findByIdAndDelete(req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    await logAudit(req, "DELETE_PCN", "PCN", { resourceId: req.params.id, detail: `Deleted PCN: ${pcn.name}` });
    res.json({ success: true, message: "PCN deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Restricted Clinicians
export const updateRestrictedClinicians = async (req, res) => {
  try {
    const { clinicianId, action } = req.body; // action: "add" | "remove"
    const pcn = await PCN.findById(req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    if (action === "add") {
      if (!pcn.restrictedClinicians.includes(clinicianId))
        pcn.restrictedClinicians.push(clinicianId);
    } else {
      pcn.restrictedClinicians = pcn.restrictedClinicians.filter(id => id.toString() !== clinicianId);
    }
    await pcn.save();
    await logAudit(req, "UPDATE_PCN", "PCN", { resourceId: pcn._id, detail: `${action === "add" ? "Added" : "Removed"} restricted clinician` });
    res.json({ success: true, pcn });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


//  PRACTICE CRUD


export const getPractices = async (req, res) => {
  try {
    const filter = {};
    if (req.query.pcn) filter.pcn = req.query.pcn;
    const practices = await Practice.find(filter)
      .populate("pcn", "name")
      .populate("linkedClinicians", "name email role")
      .sort({ name: 1 });
    res.json({ success: true, practices });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const getPracticeById = async (req, res) => {
  try {
    const practice = await Practice.findById(req.params.id)
      .populate("pcn", "name icb")
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role");
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    res.json({ success: true, practice });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const createPractice = async (req, res) => {
  try {
    const { name, pcn, address, odsCode, contacts, linkedClinicians, systemAccessNotes } = req.body;
    if (!name || !pcn) return res.status(400).json({ message: "Name and PCN are required" });
    const practice = await Practice.create({ name, pcn, address, odsCode, contacts, linkedClinicians, systemAccessNotes, createdBy: req.user._id });
    await logAudit(req, "CREATE_PRACTICE", "Practice", { resourceId: practice._id, detail: `Created Practice: ${practice.name}` });
    res.status(201).json({ success: true, practice });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const updatePractice = async (req, res) => {
  try {
    const practice = await Practice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    await logAudit(req, "UPDATE_PRACTICE", "Practice", { resourceId: practice._id, detail: `Updated Practice: ${practice.name}` });
    res.json({ success: true, practice });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const deletePractice = async (req, res) => {
  try {
    const practice = await Practice.findByIdAndDelete(req.params.id);
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    await logAudit(req, "DELETE_PRACTICE", "Practice", { resourceId: req.params.id, detail: `Deleted Practice: ${practice.name}` });
    res.json({ success: true, message: "Practice deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


//  CONTACT HISTORY


export const getContactHistory = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { type, starred, page = 1, limit = 30, search } = req.query;

    const filter = { entityType, entityId };
    if (type)    filter.type    = type;
    if (starred === "true") filter.starred = true;
    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: "i" } },
        { notes:   { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      ContactHistory.find(filter)
        .populate("createdBy", "name")
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ContactHistory.countDocuments(filter),
    ]);

    res.json({ success: true, logs, pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const addContactHistory = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { type, subject, notes, date, starred } = req.body;

    const log = await ContactHistory.create({
      entityType, entityId, type, subject, notes,
      date: date || new Date(),
      starred: starred || false,
      createdBy: req.user._id,
    });

    await logAudit(req, "ADD_CONTACT_HISTORY", entityType, {
      resourceId: entityId,
      detail: `Added ${type} contact history: ${subject}`,
    });

    res.status(201).json({ success: true, log });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const toggleStarred = async (req, res) => {
  try {
    const log = await ContactHistory.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    log.starred = !log.starred;
    await log.save();
    res.json({ success: true, log });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

export const deleteContactHistory = async (req, res) => {
  try {
    const log = await ContactHistory.findByIdAndDelete(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ success: true, message: "Log deleted" });
  } catch (err) { res.status(500).json({ message: err.message }); }
};


//  MASS EMAIL + OPEN TRACKING


export const sendMassEmail = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { subject, body, recipients } = req.body;
    // recipients = [{ email, name }]
    if (!subject || !body || !recipients?.length)
      return res.status(400).json({ message: "Subject, body, and recipients are required" });

    const trackingId = crypto.randomUUID();
    const sentRecipients = [];
    const BASE_URL = process.env.API_BASE_URL || `https://${req.headers.host}`;

    for (const r of recipients) {
      const recipientTrackingId = crypto.randomUUID();
      const pixelUrl = `${BASE_URL}/api/clients/track/${recipientTrackingId}`;
      const htmlBody = `${body}<img src="${pixelUrl}" width="1" height="1" style="display:none" />`;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to:   r.email,
        subject,
        html: htmlBody,
      });

      sentRecipients.push({
        email:      r.email,
        name:       r.name,
        opened:     false,
        openedAt:   null,
        trackingId: recipientTrackingId,
      });
    }

    const log = await ContactHistory.create({
      entityType, entityId,
      type:        "email",
      subject,
      notes:       body,
      date:        new Date(),
      isMassEmail: true,
      recipients:  sentRecipients,
      emailTracking: { sent: true, trackingId },
      createdBy: req.user._id,
    });

    await logAudit(req, "MASS_EMAIL", entityType, {
      resourceId: entityId,
      detail: `Mass email sent to ${recipients.length} recipients: ${subject}`,
    });

    res.json({ success: true, log });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Tracking pixel endpoint — 1x1 transparent gif
export const trackEmailOpen = async (req, res) => {
  try {
    const { trackingId } = req.params;
    // Find log where recipients array has this trackingId
    await ContactHistory.updateOne(
      { "recipients.trackingId": trackingId },
      {
        $set: {
          "recipients.$.opened":   true,
          "recipients.$.openedAt": new Date(),
        },
      }
    );
    // Return 1x1 transparent GIF
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.setHeader("Content-Type",  "image/gif");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.end(gif);
  } catch {
    res.status(200).end();
  }
};


//  HIERARCHY OVERVIEW (for drill-down)


export const getHierarchy = async (req, res) => {
  try {
    const icbs = await ICB.find({ isActive: true }).sort({ name: 1 });
    const pcns = await PCN.find({ isActive: true }).populate("icb", "name").sort({ name: 1 });
    const practices = await Practice.find({ isActive: true }).populate("pcn", "name").sort({ name: 1 });

    // Build tree
    const tree = icbs.map(icb => ({
      ...icb.toObject(),
      pcns: pcns
        .filter(p => p.icb._id.toString() === icb._id.toString())
        .map(pcn => ({
          ...pcn.toObject(),
          practices: practices.filter(pr => pr.pcn._id.toString() === pcn._id.toString()),
        })),
    }));

    res.json({ success: true, tree, counts: { icbs: icbs.length, pcns: pcns.length, practices: practices.length } });
  } catch (err) { res.status(500).json({ message: err.message }); }
};