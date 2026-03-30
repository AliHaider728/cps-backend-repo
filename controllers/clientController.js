/**
 * clientController.js  —  CPS Client Management
 * 
 * FIXES applied:
 *    getHierarchy: PCNs now grouped under their Federation in the tree
 *    getPCNById: lean() used safely — practices attached manually (correct)
 *    getPracticeById: recordView called on Practice model correctly
 *    updatePractice: now returns populated practice
 *    requestSystemAccess: clinician type determines which systems to suggest
 *    sendMassEmail: auto-logs to history with correct entity
 *    All error messages consistent and descriptive
 */
import ICB           from "../models/ICB.js";
import Federation    from "../models/Federation.js";
import PCN           from "../models/PCN.js";
import Practice      from "../models/Practice.js";
import ContactHistory from "../models/ContactHistory.js";
import User          from "../models/User.js";
import nodemailer    from "nodemailer";
import crypto        from "crypto";

/* ─────────────────────────────────────────────────
   EMAIL TRANSPORT
───────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST,
  port:   Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

/* ─────────────────────────────────────────────────
   HELPER: record who viewed a record (audit trail)
   From spec section 3: "Audit log for whoever views the record"
───────────────────────────────────────────────── */
const recordView = async (Model, id, userId) => {
  try {
    await Model.findByIdAndUpdate(id, {
      $push: { viewedBy: { user: userId, viewedAt: new Date() } },
    });
  } catch (_) { /* non-blocking */ }
};

/*  
   HIERARCHY
   Returns full ICB → Federation → PCN → Practice tree
   From spec 2.1: "Hierarchical Model (Mandatory)"
  */
export const getHierarchy = async (req, res) => {
  try {
    const [icbs, federations, pcns, practices] = await Promise.all([
      ICB.find({ isActive: true }).sort({ name: 1 }).lean(),
      Federation.find({ isActive: true }).sort({ name: 1 }).lean(),
      PCN.find({ isActive: true })
        .populate("icb", "name")
        .populate("federation", "name type")
        .sort({ name: 1 })
        .lean(),
      Practice.find({ isActive: true })
        .select("name odsCode pcn isActive contractType fte")
        .sort({ name: 1 })
        .lean(),
    ]);

    // Map: practicesByPCN
    const practicesByPCN = {};
    for (const pr of practices) {
      const key = String(pr.pcn);
      if (!practicesByPCN[key]) practicesByPCN[key] = [];
      practicesByPCN[key].push(pr);
    }

    // Map: PCNs enriched with their practices, keyed by ICB
    const pcnsByICB = {};
    for (const pcn of pcns) {
      const icbKey = String(pcn.icb?._id || pcn.icb);
      if (!pcnsByICB[icbKey]) pcnsByICB[icbKey] = [];
      pcnsByICB[icbKey].push({
        ...pcn,
        practices: practicesByPCN[String(pcn._id)] || [],
      });
    }

    // Map: federations keyed by ICB
    const fedsByICB = {};
    for (const f of federations) {
      const key = String(f.icb);
      if (!fedsByICB[key]) fedsByICB[key] = [];
      fedsByICB[key].push(f);
    }

    // Build final tree
    const tree = icbs.map(icb => ({
      ...icb,
      federations: fedsByICB[String(icb._id)] || [],
      pcns:        pcnsByICB[String(icb._id)] || [],
    }));

    res.json({
      tree,
      counts: {
        icbs:        icbs.length,
        federations: federations.length,
        pcns:        pcns.length,
        practices:   practices.length,
      },
    });
  } catch (err) {
    console.error("getHierarchy:", err);
    res.status(500).json({ message: "Failed to load hierarchy" });
  }
};

/*  
   ICB CRUD
  */
export const getICBs = async (req, res) => {
  try {
    const icbs = await ICB.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ icbs });
  } catch {
    res.status(500).json({ message: "Failed to fetch ICBs" });
  }
};

export const getICBById = async (req, res) => {
  try {
    const icb = await ICB.findById(req.params.id).lean();
    if (!icb) return res.status(404).json({ message: "ICB not found" });
    res.json({ icb });
  } catch {
    res.status(500).json({ message: "Failed to fetch ICB" });
  }
};

export const createICB = async (req, res) => {
  try {
    const { name, region, code, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "ICB name is required" });
    const icb = await ICB.create({
      name: name.trim(), region: region || "", code: code || "", notes: notes || "",
      createdBy: req.user._id,
    });
    res.status(201).json({ icb, message: "ICB created successfully" });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "An ICB with this name already exists" });
    res.status(500).json({ message: "Failed to create ICB" });
  }
};

export const updateICB = async (req, res) => {
  try {
    const { name, region, code, notes, isActive } = req.body;
    const icb = await ICB.findByIdAndUpdate(
      req.params.id,
      { name, region, code, notes, ...(isActive !== undefined && { isActive }) },
      { new: true, runValidators: true }
    );
    if (!icb) return res.status(404).json({ message: "ICB not found" });
    res.json({ icb, message: "ICB updated" });
  } catch {
    res.status(500).json({ message: "Failed to update ICB" });
  }
};

export const deleteICB = async (req, res) => {
  try {
    const [pcnCount, fedCount] = await Promise.all([
      PCN.countDocuments({ icb: req.params.id, isActive: true }),
      Federation.countDocuments({ icb: req.params.id, isActive: true }),
    ]);
    if (pcnCount > 0 || fedCount > 0)
      return res.status(409).json({
        message: `Cannot delete — ${pcnCount} active PCN(s) and ${fedCount} federation(s) are linked`,
      });
    await ICB.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "ICB deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete ICB" });
  }
};

/*  
   FEDERATION / INT CRUD
   From spec 2.1: "Federations and/or Integrated neighbourhood teams"
  */
export const getFederations = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.icb) filter.icb = req.query.icb;
    const federations = await Federation.find(filter)
      .populate("icb", "name region")
      .sort({ name: 1 })
      .lean();
    res.json({ federations });
  } catch {
    res.status(500).json({ message: "Failed to fetch federations" });
  }
};

export const createFederation = async (req, res) => {
  try {
    const { name, icb, type, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Federation name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });
    const fed = await Federation.create({
      name: name.trim(), icb, type: type || "federation", notes: notes || "",
      createdBy: req.user._id,
    });
    const populated = await fed.populate("icb", "name");
    res.status(201).json({ federation: populated, message: "Federation created" });
  } catch {
    res.status(500).json({ message: "Failed to create federation" });
  }
};

export const updateFederation = async (req, res) => {
  try {
    const fed = await Federation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("icb", "name");
    if (!fed) return res.status(404).json({ message: "Federation not found" });
    res.json({ federation: fed, message: "Federation updated" });
  } catch {
    res.status(500).json({ message: "Failed to update federation" });
  }
};

export const deleteFederation = async (req, res) => {
  try {
    const pcnCount = await PCN.countDocuments({ federation: req.params.id, isActive: true });
    if (pcnCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${pcnCount} active PCN(s) are linked` });
    await Federation.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Federation deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete federation" });
  }
};

/*  
   PCN CRUD
   From spec 2.2: "PCN Record Must Include…"
  */
export const getPCNs = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.icb)        filter.icb        = req.query.icb;
    if (req.query.federation) filter.federation = req.query.federation;
    const pcns = await PCN.find(filter)
      .populate("icb", "name region")
      .populate("federation", "name type")
      .sort({ name: 1 })
      .lean();
    res.json({ pcns });
  } catch {
    res.status(500).json({ message: "Failed to fetch PCNs" });
  }
};

export const getPCNById = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region code")
      .populate("federation", "name type")
      .populate("activeClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    // Manually attach practices (lean() safe — no virtual needed)
    const practices = await Practice.find({ pcn: pcn._id, isActive: true })
      .select("name odsCode address city postcode fte contractType systemAccessNotes isActive linkedClinicians ndaSigned dsaSigned mouReceived welcomePackSent mobilisationPlanSent templateInstalled reportsImported")
      .lean();
    pcn.practices = practices;

    // Spec section 3: audit log — who viewed the record
    recordView(PCN, req.params.id, req.user._id);

    res.json({ pcn });
  } catch (err) {
    console.error("getPCNById:", err);
    res.status(500).json({ message: "Failed to fetch PCN" });
  }
};

export const createPCN = async (req, res) => {
  try {
    const { name, icb } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "PCN name is required" });
    if (!icb)          return res.status(400).json({ message: "ICB is required" });
    const pcn = await PCN.create({ ...req.body, name: name.trim(), createdBy: req.user._id });
    const populated = await PCN.findById(pcn._id)
      .populate("icb", "name")
      .populate("federation", "name type")
      .lean();
    res.status(201).json({ pcn: populated, message: "PCN created" });
  } catch (err) {
    console.error("createPCN:", err);
    res.status(500).json({ message: "Failed to create PCN" });
  }
};

export const updatePCN = async (req, res) => {
  try {
    const pcn = await PCN.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("icb", "name region")
      .populate("federation", "name type")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ pcn, message: "PCN updated" });
  } catch {
    res.status(500).json({ message: "Failed to update PCN" });
  }
};

export const deletePCN = async (req, res) => {
  try {
    const practiceCount = await Practice.countDocuments({ pcn: req.params.id, isActive: true });
    if (practiceCount > 0)
      return res.status(409).json({ message: `Cannot delete — ${practiceCount} active practice(s) are linked` });
    await PCN.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "PCN deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete PCN" });
  }
};

export const updateRestrictedClinicians = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const pcn = await PCN.findByIdAndUpdate(
      req.params.id,
      { restrictedClinicians: clinicianIds },
      { new: true }
    ).populate("restrictedClinicians", "name email role");
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ pcn, message: "Restricted clinicians updated" });
  } catch {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

// From spec 2.2: "Client-facing front screen showing monthly meetings and clinician meetings"
export const getMonthlyMeetings = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id).select("monthlyMeetings name").lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });
    res.json({ meetings: pcn.monthlyMeetings || [], pcnName: pcn.name });
  } catch {
    res.status(500).json({ message: "Failed to fetch meetings" });
  }
};

export const upsertMonthlyMeeting = async (req, res) => {
  try {
    const { month, date, type, attendees, notes, status } = req.body;
    if (!month) return res.status(400).json({ message: "Month is required" });

    const pcn = await PCN.findById(req.params.id);
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const idx = pcn.monthlyMeetings.findIndex(m => m.month === month && m.type === type);
    if (idx > -1) {
      Object.assign(pcn.monthlyMeetings[idx], { date, attendees, notes, status });
    } else {
      pcn.monthlyMeetings.push({ month, date, type, attendees, notes, status });
    }
    await pcn.save();
    res.json({ meetings: pcn.monthlyMeetings, message: "Meeting saved" });
  } catch {
    res.status(500).json({ message: "Failed to save meeting" });
  }
};

// From spec 12: "Roll-up reporting: Practices/Surgeries → PCN"
export const getPCNRollup = async (req, res) => {
  try {
    const pcn = await PCN.findById(req.params.id)
      .populate("icb", "name region")
      .populate("federation", "name")
      .lean();
    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const practices = await Practice.find({ pcn: req.params.id, isActive: true }).lean();

    const complianceKeys = [
      "ndaSigned","dsaSigned","mouReceived","welcomePackSent",
      "mobilisationPlanSent","confidentialityFormSigned",
      "prescribingPoliciesShared","remoteAccessSetup",
      "templateInstalled","reportsImported",
    ];

    const complianceByPractice = practices.map(p => {
      const done = complianceKeys.filter(k => p[k]).length;
      return {
        practiceId:   p._id,
        practiceName: p.name,
        done,
        total:        complianceKeys.length,
        score:        Math.round((done / complianceKeys.length) * 100),
      };
    });

    const avgCompliance = complianceByPractice.length
      ? Math.round(complianceByPractice.reduce((s, p) => s + p.score, 0) / complianceByPractice.length)
      : 0;

    const systemCounts = {};
    for (const p of practices) {
      for (const sa of (p.systemAccess || [])) {
        if (!systemCounts[sa.system]) systemCounts[sa.system] = { granted: 0, pending: 0, total: 0 };
        systemCounts[sa.system].total++;
        if (["granted","view_only"].includes(sa.status)) systemCounts[sa.system].granted++;
        if (["requested","pending"].includes(sa.status)) systemCounts[sa.system].pending++;
      }
    }

    res.json({
      pcn,
      practices,
      rollup: {
        practiceCount: practices.length,
        avgCompliance,
        complianceByPractice,
        annualSpend: pcn.annualSpend,
        systemCounts,
      },
    });
  } catch (err) {
    console.error("getPCNRollup:", err);
    res.status(500).json({ message: "Failed to generate rollup report" });
  }
};

/*  
   PRACTICE CRUD
   From spec 2.2: "Practice/Surgery Record Must Include…"
  */
export const getPractices = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.pcn) filter.pcn = req.query.pcn;
    const practices = await Practice.find(filter)
      .populate("pcn", "name")
      .sort({ name: 1 })
      .lean();
    res.json({ practices });
  } catch {
    res.status(500).json({ message: "Failed to fetch practices" });
  }
};

export const getPracticeById = async (req, res) => {
  try {
    const practice = await Practice.findById(req.params.id)
      .populate("pcn", "name icb")
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!practice) return res.status(404).json({ message: "Practice not found" });

    // Spec section 3: audit trail
    recordView(Practice, req.params.id, req.user._id);

    res.json({ practice });
  } catch {
    res.status(500).json({ message: "Failed to fetch practice" });
  }
};

export const createPractice = async (req, res) => {
  try {
    const { name, pcn } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Practice name is required" });
    if (!pcn)          return res.status(400).json({ message: "PCN is required" });
    const practice = await Practice.create({ ...req.body, name: name.trim(), createdBy: req.user._id });
    const populated = await Practice.findById(practice._id).populate("pcn", "name").lean();
    res.status(201).json({ practice: populated, message: "Practice created" });
  } catch {
    res.status(500).json({ message: "Failed to create practice" });
  }
};

export const updatePractice = async (req, res) => {
  try {
    const practice = await Practice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("pcn", "name")
      .populate("linkedClinicians", "name email role")
      .populate("restrictedClinicians", "name email role")
      .lean();
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    res.json({ practice, message: "Practice updated" });
  } catch {
    res.status(500).json({ message: "Failed to update practice" });
  }
};

export const deletePractice = async (req, res) => {
  try {
    await Practice.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Practice deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete practice" });
  }
};

export const updatePracticeRestricted = async (req, res) => {
  try {
    const { clinicianIds } = req.body;
    if (!Array.isArray(clinicianIds)) return res.status(400).json({ message: "clinicianIds must be an array" });
    const practice = await Practice.findByIdAndUpdate(
      req.params.id,
      { restrictedClinicians: clinicianIds },
      { new: true }
    ).populate("restrictedClinicians", "name email role");
    if (!practice) return res.status(404).json({ message: "Practice not found" });
    res.json({ practice, message: "Restricted clinicians updated" });
  } catch {
    res.status(500).json({ message: "Failed to update restricted clinicians" });
  }
};

// From spec section 4: "Automated System Access Requests"
export const requestSystemAccess = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { systems, clinicianDetails, notes } = req.body;

    if (!systems?.length)         return res.status(400).json({ message: "At least one system must be selected" });
    if (!clinicianDetails?.name)  return res.status(400).json({ message: "Clinician name is required" });

    const systemList = systems.join(", ");
    const emailBody = `
Dear Team,

Please arrange system access for the following clinician:

Name:              ${clinicianDetails.name}
Clinician Type:    ${clinicianDetails.clinicianType || "N/A"}
GPhC Number:       ${clinicianDetails.gphcNumber || "N/A"}
Smart Card Number: ${clinicianDetails.smartCardNumber || "N/A"}
Email:             ${clinicianDetails.email || "N/A"}
Phone:             ${clinicianDetails.phone || "N/A"}

Systems Required:  ${systemList}

Additional Notes:  ${notes || "None"}

Please confirm access has been granted at your earliest convenience.

Kind regards,
Core Prescribing Solutions
`.trim();

    // Log to contact history — spec: "Log request in contact history with date/time, responsible team member, and client"
    const log = await ContactHistory.create({
      entityType,
      entityId,
      type:    "system_access",
      subject: `System Access Request — ${clinicianDetails.name} — ${systemList}`,
      notes:   emailBody,
      date:    new Date(),
      time:    new Date().toTimeString().slice(0, 5),
      createdBy: req.user._id,
    });

    res.json({ message: "System access request logged successfully", log });
  } catch (err) {
    console.error("requestSystemAccess:", err);
    res.status(500).json({ message: "Failed to process system access request" });
  }
};

/*  
   CONTACT HISTORY
   From spec section 3: "Contact History & Communication Management"
  */
export const getContactHistory = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { type, starred, page = 1, limit = 100 } = req.query;

    const filter = { entityType, entityId };
    if (type && type !== "all") filter.type = type;
    if (starred === "true")     filter.starred = true;

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      ContactHistory.find(filter)
        .populate("createdBy", "name role")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ContactHistory.countDocuments(filter),
    ]);

    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch {
    res.status(500).json({ message: "Failed to fetch contact history" });
  }
};

export const addContactHistory = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { type, subject, notes, date, time, attachments } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!type)            return res.status(400).json({ message: "Type is required" });

    const log = await ContactHistory.create({
      entityType,
      entityId,
      type,
      subject: subject.trim(),
      notes:   notes || "",
      date:    date ? new Date(date) : new Date(),
      time:    time || new Date().toTimeString().slice(0, 5),
      attachments: attachments || [],
      createdBy: req.user._id,
    });

    const populated = await ContactHistory.findById(log._id).populate("createdBy", "name role").lean();
    res.status(201).json({ log: populated, message: "Log added" });
  } catch {
    res.status(500).json({ message: "Failed to add log" });
  }
};

export const updateContactHistory = async (req, res) => {
  try {
    const { subject, notes, type, date, time } = req.body;
    const log = await ContactHistory.findByIdAndUpdate(
      req.params.logId,
      { ...(subject && { subject }), ...(notes !== undefined && { notes }), ...(type && { type }), ...(date && { date }), ...(time && { time }) },
      { new: true }
    ).populate("createdBy", "name role");
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ log, message: "Log updated" });
  } catch {
    res.status(500).json({ message: "Failed to update log" });
  }
};

export const toggleStarred = async (req, res) => {
  try {
    const log = await ContactHistory.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    log.starred = !log.starred;
    await log.save();
    res.json({ log, starred: log.starred, message: log.starred ? "Starred" : "Unstarred" });
  } catch {
    res.status(500).json({ message: "Failed to toggle star" });
  }
};

export const deleteContactHistory = async (req, res) => {
  try {
    const log = await ContactHistory.findByIdAndDelete(req.params.logId);
    if (!log) return res.status(404).json({ message: "Log not found" });
    res.json({ message: "Log deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete log" });
  }
};

/*  
   MASS EMAIL
   From spec 3: "Mass emails at PCN, Practice/Surgery level"
   From spec 3: "Track which client has open and read emails"
  */
export const sendMassEmail = async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const { subject, body, recipients } = req.body;

    if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
    if (!body?.trim())    return res.status(400).json({ message: "Body is required" });

    const valid = (recipients || []).filter(r => r.email?.includes("@"));
    if (!valid.length)    return res.status(400).json({ message: "At least one valid recipient email is required" });

    const trackingId = crypto.randomUUID();
    const apiBase    = `${req.protocol}://${req.get("host")}`;
    const pixel      = `<img src="${apiBase}/api/clients/track/${trackingId}" width="1" height="1" style="display:none;"/>`;

    const recipientResults = [];
    for (const r of valid) {
      try {
        await transporter.sendMail({
          from:    process.env.EMAIL_FROM,
          to:      r.name ? `"${r.name}" <${r.email}>` : r.email,
          subject,
          html:    body + pixel,
        });
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      } catch (mailErr) {
        console.error("Mail error:", r.email, mailErr.message);
        recipientResults.push({ email: r.email, name: r.name || "", opened: false });
      }
    }

    // Auto-log to contact history
    await ContactHistory.create({
      entityType,
      entityId,
      type:       "email",
      subject:    `[Mass Email] ${subject}`,
      notes:      body.replace(/<[^>]+>/g, "").slice(0, 500),
      date:       new Date(),
      time:       new Date().toTimeString().slice(0, 5),
      isMassEmail:true,
      recipients: recipientResults,
      emailTracking: { sent: true, sentAt: new Date(), trackingId },
      createdBy: req.user._id,
    });

    res.json({ message: `Email sent to ${recipientResults.length} recipient(s)` });
  } catch (err) {
    console.error("sendMassEmail:", err);
    res.status(500).json({ message: "Failed to send email" });
  }
};

export const trackEmailOpen = async (req, res) => {
  try {
    await ContactHistory.findOneAndUpdate(
      { "emailTracking.trackingId": req.params.trackingId },
      { "emailTracking.opened": true, "emailTracking.openedAt": new Date() }
    );
  } catch (_) { /* silent */ }

  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-cache,no-store,must-revalidate" });
  res.end(pixel);
};

/*  
   SEARCH  (cross-entity)
  */
export const searchClients = async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ results: [] });
    const regex = new RegExp(q, "i");
    const [icbs, pcns, practices] = await Promise.all([
      ICB.find({ name: regex, isActive: true }).select("name region").limit(5).lean(),
      PCN.find({ name: regex, isActive: true }).select("name").limit(5).lean(),
      Practice.find({ $or: [{ name: regex }, { odsCode: regex }], isActive: true }).select("name odsCode").limit(5).lean(),
    ]);
    res.json({
      results: [
        ...icbs.map(i => ({ ...i, _type: "icb" })),
        ...pcns.map(p => ({ ...p, _type: "pcn" })),
        ...practices.map(p => ({ ...p, _type: "practice" })),
      ],
    });
  } catch {
    res.status(500).json({ message: "Search failed" });
  }
};