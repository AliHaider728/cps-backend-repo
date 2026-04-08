import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./models/User.js";
import ICB from "./models/ICB.js";
import Federation from "./models/Federation.js";
import PCN from "./models/PCN.js";
import Practice from "./models/Practice.js";
import ContactHistory from "./models/ContactHistory.js";
import AuditLog from "./models/AuditLog.js";
import ComplianceDocument from "./models/ComplianceDocument.js";
import DocumentGroup from "./models/DocumentGroup.js";
import connectDB from "./config/db.js";

const SAMPLE_FILE_URL = "data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrp/Og0MTGCjEgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCnRyYWlsZXIKPDwKPj4KJSVFT0Y=";

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

const COMPLIANCE_DOCUMENTS = [
  { name: "DBS Check", displayOrder: 1, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 30 },
  { name: "Passport", displayOrder: 2, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Signed NDA", displayOrder: 3, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Indemnity Insurance", displayOrder: 4, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 30 },
  { name: "Training Certificate", displayOrder: 5, mandatory: true, expirable: true, active: true, defaultExpiryDays: 365, defaultReminderDays: 30 },
  { name: "Right to Work", displayOrder: 6, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "GDPR Statement", displayOrder: 7, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Confidentiality Statement", displayOrder: 8, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "CV", displayOrder: 9, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Reference 1", displayOrder: 10, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Reference 2", displayOrder: 11, mandatory: true, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
  { name: "Enhanced Access Contacts", displayOrder: 12, mandatory: false, expirable: false, active: true, defaultExpiryDays: 0, defaultReminderDays: 0 },
];

const DOCUMENT_GROUPS = [
  { name: "Clinical Staff Documents", displayOrder: 1, active: true, docNames: ["DBS Check", "Passport", "CV", "Right to Work", "Signed NDA", "Training Certificate", "Reference 1", "Reference 2"] },
  { name: "DBS and Update", displayOrder: 2, active: true, docNames: ["DBS Check"] },
  { name: "Non-Clinical Staff", displayOrder: 3, active: true, docNames: ["Passport", "Right to Work", "GDPR Statement", "Confidentiality Statement", "Signed NDA"] },
  { name: "Insurance and Governance", displayOrder: 4, active: true, docNames: ["Indemnity Insurance", "GDPR Statement", "Signed NDA"] },
  { name: "Enhanced Access", displayOrder: 5, active: true, docNames: ["Enhanced Access Contacts", "Training Certificate"] },
];

const ICBS = [
  { name: "NHS Greater Manchester ICB", region: "North West", code: "QOP" },
  { name: "NHS Cheshire & Merseyside ICB", region: "North West", code: "QYG" },
];

const FEDERATIONS = [
  { name: "Salford Together Federation", type: "federation", icbName: "NHS Greater Manchester ICB" },
  { name: "Manchester Health & Care Commissioning", type: "federation", icbName: "NHS Greater Manchester ICB" },
  { name: "Cheshire & Wirral Foundation Trust", type: "federation", icbName: "NHS Cheshire & Merseyside ICB" },
];

const PCNS = [
  {
    name: "Salford Central PCN",
    icbName: "NHS Greater Manchester ICB",
    federationName: "Salford Together Federation",
    annualSpend: 280000,
    contractType: "ARRS",
    xeroCode: "SAL1",
    xeroCategory: "PCN",
    contractRenewalDate: new Date("2026-04-01"),
    contractExpiryDate: new Date("2027-03-31"),
    notes: "Demo PCN with multiple assigned compliance groups and active documents.",
    groupNames: ["Clinical Staff Documents", "DBS and Update", "Enhanced Access"],
    contacts: [
      { name: "Dr. Priya Sharma", role: "Clinical Director", email: "priya.sharma@salfordpcn.nhs.uk", phone: "0161 234 5678", type: "decision_maker" },
      { name: "Kevin Walsh", role: "PCN Manager", email: "kevin.walsh@salfordpcn.nhs.uk", phone: "0161 234 5679", type: "general" },
    ],
  },
  {
    name: "Wythenshawe & Benchill PCN",
    icbName: "NHS Greater Manchester ICB",
    federationName: "Manchester Health & Care Commissioning",
    annualSpend: 195000,
    contractType: "EA",
    xeroCode: "WYT1",
    xeroCategory: "PCN",
    contractRenewalDate: new Date("2026-06-01"),
    contractExpiryDate: new Date("2027-05-31"),
    notes: "Demo PCN using non-clinical and governance document groups.",
    groupNames: ["Non-Clinical Staff", "Insurance and Governance"],
    contacts: [
      { name: "Dr. Mohammed Iqbal", role: "Clinical Director", email: "m.iqbal@wythpcn.nhs.uk", phone: "0161 945 1234", type: "decision_maker" },
    ],
  },
  {
    name: "Liverpool South PCN",
    icbName: "NHS Cheshire & Merseyside ICB",
    federationName: "Cheshire & Wirral Foundation Trust",
    annualSpend: 220000,
    contractType: "ARRS",
    xeroCode: "LIV1",
    xeroCategory: "PCN",
    contractRenewalDate: new Date("2026-01-01"),
    contractExpiryDate: new Date("2026-12-31"),
    notes: "Demo PCN with strong governance and enhanced access setup.",
    groupNames: ["Clinical Staff Documents", "Insurance and Governance", "Enhanced Access"],
    contacts: [
      { name: "Diane Morris", role: "PCN Manager", email: "diane.morris@livsouth.nhs.uk", phone: "0151 233 4001", type: "general" },
    ],
  },
];

const PRACTICES = [
  {
    pcnName: "Salford Central PCN",
    name: "Pendleton Medical Centre",
    odsCode: "P84001",
    address: "15 Broad Street",
    city: "Salford",
    postcode: "M6 5BN",
    fte: "0.5 FTE",
    contractType: "ARRS",
    xeroCode: "PEN1",
    xeroCategory: "GPX",
    patientListSize: 11400,
    notes: "Strong demo practice with working document uploads.",
    groupName: "Clinical Staff Documents",
    systemAccess: [{ system: "EMIS", status: "granted" }, { system: "ICE", status: "granted" }],
  },
  {
    pcnName: "Salford Central PCN",
    name: "Weaste & Seedley Surgery",
    odsCode: "P84002",
    address: "42 Liverpool Street",
    city: "Salford",
    postcode: "M5 4LT",
    fte: "0.4 FTE",
    contractType: "ARRS",
    xeroCode: "WEA1",
    xeroCategory: "GPX",
    patientListSize: 9200,
    notes: "Demonstrates partial document completion and pending uploads.",
    groupName: "DBS and Update",
    systemAccess: [{ system: "EMIS", status: "view_only" }, { system: "ICE", status: "requested" }],
  },
  {
    pcnName: "Wythenshawe & Benchill PCN",
    name: "Benchill Medical Practice",
    odsCode: "P84003",
    address: "21 Brownley Road",
    city: "Manchester",
    postcode: "M22 8HN",
    fte: "0.6 FTE",
    contractType: "EA",
    xeroCode: "BEN1",
    xeroCategory: "GPX",
    patientListSize: 10150,
    notes: "Non-clinical group assigned to match admin-focused demo flow.",
    groupName: "Non-Clinical Staff",
    systemAccess: [{ system: "EMIS", status: "granted" }],
  },
  {
    pcnName: "Wythenshawe & Benchill PCN",
    name: "Forum Health Centre",
    odsCode: "P84004",
    address: "Forum Centre",
    city: "Manchester",
    postcode: "M22 5RX",
    fte: "0.5 FTE",
    contractType: "EA",
    xeroCode: "FOR1",
    xeroCategory: "GPX",
    patientListSize: 13500,
    notes: "Governance-heavy demo practice.",
    groupName: "Insurance and Governance",
    systemAccess: [{ system: "EMIS", status: "granted" }, { system: "Docman", status: "granted" }],
  },
  {
    pcnName: "Liverpool South PCN",
    name: "Speke Medical Centre",
    odsCode: "P83001",
    address: "Speke Road",
    city: "Liverpool",
    postcode: "L24 2SQ",
    fte: "0.5 FTE",
    contractType: "ARRS",
    xeroCode: "SPE1",
    xeroCategory: "GPX",
    patientListSize: 9800,
    notes: "Enhanced access and training-focused example.",
    groupName: "Enhanced Access",
    systemAccess: [{ system: "SystmOne", status: "granted" }, { system: "AccuRx", status: "granted" }],
  },
  {
    pcnName: "Liverpool South PCN",
    name: "Garston Family Practice",
    odsCode: "P83002",
    address: "Church Road",
    city: "Liverpool",
    postcode: "L19 2LW",
    fte: "0.4 FTE",
    contractType: "ARRS",
    xeroCode: "GAR1",
    xeroCategory: "GPX",
    patientListSize: 8700,
    notes: "Clinical staff group with mixed upload statuses.",
    groupName: "Clinical Staff Documents",
    systemAccess: [{ system: "SystmOne", status: "granted" }],
  },
];

const HISTORY_TEMPLATES = [
  { type: "meeting", subject: "Monthly performance review", notes: "Discussed KPIs, workforce capacity, and compliance progress." },
  { type: "call", subject: "Contract renewal discussion", notes: "Reviewed renewal dates and pricing assumptions." },
  { type: "email", subject: "Document follow-up", notes: "Requested remaining documents and confirmed the next upload window." },
  { type: "system_access", subject: "System access request", notes: "Requested EMIS / SystmOne access for clinical onboarding." },
];

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000);

const slugify = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const buildUpload = (document, label, uploadedBy, options = {}) => {
  const uploadedAt = options.uploadedAt || daysAgo(options.daysAgo ?? 10);
  const expiryDate = document.expirable
    ? (options.expiryDate || new Date(uploadedAt.getTime() + (document.defaultExpiryDays || 365) * 24 * 60 * 60 * 1000))
    : null;
  const status = document.expirable && expiryDate && expiryDate < new Date() ? "expired" : "uploaded";

  return {
    uploadId: new mongoose.Types.ObjectId().toString(),
    fileName: `${slugify(label)}-${slugify(document.name)}.pdf`,
    fileUrl: SAMPLE_FILE_URL,
    mimeType: "application/pdf",
    fileSize: 1024,
    status,
    uploadedAt,
    expiryDate,
    renewalDate: expiryDate,
    notes: options.notes || `${document.name} uploaded for demo data.`,
    reference: options.reference || `${slugify(label).toUpperCase()}-${document.displayOrder}`,
    uploadedBy,
  };
};

const buildGroupDocumentRecord = (group, document, uploadedBy, options = {}) => {
  const uploads = options.includeUpload === false ? [] : [buildUpload(document, options.label || group.name, uploadedBy, options)];
  const latestUpload = uploads[0] || null;
  return {
    group: group._id,
    document: document._id,
    fileName: latestUpload?.fileName || "",
    fileUrl: latestUpload?.fileUrl || "",
    mimeType: latestUpload?.mimeType || "",
    fileSize: latestUpload?.fileSize || 0,
    status: latestUpload?.status || "pending",
    uploadedAt: latestUpload?.uploadedAt || null,
    expiryDate: latestUpload?.expiryDate || null,
    renewalDate: latestUpload?.renewalDate || null,
    notes: latestUpload?.notes || "",
    uploadedBy: latestUpload?.uploadedBy || null,
    lastUpdatedBy: uploadedBy,
    uploads,
  };
};

async function resetCollections() {
  await Promise.all([
    AuditLog.deleteMany({}),
    ContactHistory.deleteMany({}),
    Practice.deleteMany({}),
    PCN.deleteMany({}),
    Federation.deleteMany({}),
    ICB.deleteMany({}),
    DocumentGroup.deleteMany({}),
    ComplianceDocument.deleteMany({}),
  ]);
}

async function upsertUsers() {
  const users = [];
  for (const user of USERS) {
    const password = await bcrypt.hash(user.password, 12);
    const saved = await User.findOneAndUpdate(
      { email: user.email },
      {
        name: user.name,
        email: user.email,
        password,
        role: user.role,
        isActive: true,
        mustChangePassword: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    users.push(saved);
  }
  return users;
}

async function seedCompliance(adminId) {
  const documentMap = new Map();
  for (const document of COMPLIANCE_DOCUMENTS) {
    const saved = await ComplianceDocument.create({ ...document, createdBy: adminId });
    documentMap.set(document.name, saved);
  }

  const groupMap = new Map();
  for (const group of DOCUMENT_GROUPS) {
    const docIds = group.docNames.map((name) => documentMap.get(name)?._id).filter(Boolean);
    const saved = await DocumentGroup.create({
      name: group.name,
      displayOrder: group.displayOrder,
      active: group.active,
      documents: docIds,
      createdBy: adminId,
    });
    groupMap.set(group.name, saved);
  }

  return { documentMap, groupMap };
}

async function seedHierarchy(admin, clinicians, groupMap, documentMap) {
  const icbMap = new Map();
  for (const icb of ICBS) {
    const saved = await ICB.create({ ...icb, createdBy: admin._id });
    icbMap.set(icb.name, saved);
  }

  const federationMap = new Map();
  for (const federation of FEDERATIONS) {
    const saved = await Federation.create({
      name: federation.name,
      type: federation.type,
      icb: icbMap.get(federation.icbName)._id,
      createdBy: admin._id,
    });
    federationMap.set(federation.name, saved);
  }

  const pcnMap = new Map();
  for (const pcnData of PCNS) {
    const groups = pcnData.groupNames.map((name) => groupMap.get(name)).filter(Boolean);
    const recordDocs = [];
    groups.forEach((group, index) => {
      const docs = DOCUMENT_GROUPS.find((item) => item.name === group.name)?.docNames || [];
      docs.slice(0, 2).forEach((docName, docIndex) => {
        const document = documentMap.get(docName);
        if (!document) return;
        recordDocs.push(buildGroupDocumentRecord(group, document, admin._id, {
          label: pcnData.name,
          daysAgo: 12 + docIndex + index,
          includeUpload: !(index === 0 && docIndex === 1 && pcnData.name === "Wythenshawe & Benchill PCN"),
        }));
      });
    });

    const saved = await PCN.create({
      name: pcnData.name,
      icb: icbMap.get(pcnData.icbName)._id,
      federation: federationMap.get(pcnData.federationName)?._id || null,
      federationName: pcnData.federationName,
      annualSpend: pcnData.annualSpend,
      contractType: pcnData.contractType,
      xeroCode: pcnData.xeroCode,
      xeroCategory: pcnData.xeroCategory,
      contractRenewalDate: pcnData.contractRenewalDate,
      contractExpiryDate: pcnData.contractExpiryDate,
      notes: pcnData.notes,
      contacts: pcnData.contacts,
      complianceGroup: groups[0]?._id || null,
      complianceGroups: groups.map((group) => group._id),
      groupDocuments: recordDocs,
      activeClinicians: clinicians.map((user) => user._id),
      restrictedClinicians: clinicians.slice(0, 1).map((user) => user._id),
      createdBy: admin._id,
      ndaSigned: true,
      dsaSigned: true,
      mouReceived: true,
      welcomePackSent: true,
      govChecklist: true,
      insuranceCert: true,
    });
    pcnMap.set(pcnData.name, saved);
  }

  const practiceMap = new Map();
  for (const practiceData of PRACTICES) {
    const group = groupMap.get(practiceData.groupName);
    const groupDocNames = DOCUMENT_GROUPS.find((item) => item.name === practiceData.groupName)?.docNames || [];
    const groupDocuments = groupDocNames.slice(0, 2).map((docName, index) => {
      const document = documentMap.get(docName);
      return buildGroupDocumentRecord(group, document, admin._id, {
        label: practiceData.name,
        daysAgo: 5 + index,
        includeUpload: !(practiceData.name === "Weaste & Seedley Surgery" && index === 1),
      });
    }).filter(Boolean);

    const saved = await Practice.create({
      name: practiceData.name,
      pcn: pcnMap.get(practiceData.pcnName)._id,
      odsCode: practiceData.odsCode,
      address: practiceData.address,
      city: practiceData.city,
      postcode: practiceData.postcode,
      fte: practiceData.fte,
      contractType: practiceData.contractType,
      xeroCode: practiceData.xeroCode,
      xeroCategory: practiceData.xeroCategory,
      patientListSize: practiceData.patientListSize,
      notes: practiceData.notes,
      complianceGroup: group?._id || null,
      groupDocuments,
      linkedClinicians: clinicians.map((user) => user._id),
      restrictedClinicians: clinicians.slice(1, 2).map((user) => user._id),
      systemAccess: practiceData.systemAccess,
      createdBy: admin._id,
      ndaSigned: true,
      dsaSigned: true,
      mouReceived: true,
      welcomePackSent: true,
      mobilisationPlanSent: true,
      templateInstalled: true,
      reportsImported: true,
      confidentialityFormSigned: true,
      prescribingPoliciesShared: true,
      remoteAccessSetup: true,
    });
    practiceMap.set(practiceData.name, saved);
  }

  return { icbMap, federationMap, pcnMap, practiceMap };
}

async function seedContactHistory(admin, icbMap, federationMap, pcnMap, practiceMap) {
  const createHistorySet = async (entityType, entityId, label, count = 3) => {
    for (let index = 0; index < count; index += 1) {
      const template = HISTORY_TEMPLATES[index % HISTORY_TEMPLATES.length];
      await ContactHistory.create({
        entityType,
        entityId,
        type: template.type,
        subject: `${template.subject} - ${label}`,
        notes: template.notes,
        date: daysAgo(3 + index),
        time: `${String(9 + index).padStart(2, "0")}:00`,
        starred: index === 0,
        createdBy: admin._id,
      });
    }
  };

  for (const [name, icb] of icbMap.entries()) {
    await createHistorySet("ICB", icb._id, name, 2);
  }
  for (const [name, federation] of federationMap.entries()) {
    await createHistorySet("Federation", federation._id, name, 2);
  }
  for (const [name, pcn] of pcnMap.entries()) {
    await createHistorySet("PCN", pcn._id, name, 4);
  }
  for (const [name, practice] of practiceMap.entries()) {
    await createHistorySet("Practice", practice._id, name, 3);
  }
}

async function seedAuditLogs(admin, pcnMap, practiceMap) {
  const salfordPcn = pcnMap.get("Salford Central PCN");
  const pendleton = practiceMap.get("Pendleton Medical Centre");

  await AuditLog.insertMany([
    {
      user: admin._id,
      userName: admin.name,
      userRole: admin.role,
      action: "CREATE_CLIENT",
      resource: "PCN",
      resourceId: String(salfordPcn._id),
      detail: "PCN created: Salford Central PCN",
      status: "success",
      ip: "seed-script",
      userAgent: "seed-script",
      createdAt: hoursAgo(10),
      updatedAt: hoursAgo(10),
    },
    {
      user: admin._id,
      userName: admin.name,
      userRole: admin.role,
      action: "UPDATE_CLIENT",
      resource: "PCN",
      resourceId: String(salfordPcn._id),
      detail: "Compliance groups changed from [none] to [Clinical Staff Documents, DBS and Update, Enhanced Access]",
      status: "success",
      ip: "seed-script",
      userAgent: "seed-script",
      createdAt: hoursAgo(8),
      updatedAt: hoursAgo(8),
    },
    {
      user: admin._id,
      userName: admin.name,
      userRole: admin.role,
      action: "CREATE_CLIENT",
      resource: "Practice",
      resourceId: String(pendleton._id),
      detail: "Practice created: Pendleton Medical Centre",
      status: "success",
      ip: "seed-script",
      userAgent: "seed-script",
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(6),
    },
  ]);
}

async function main() {
  await connectDB();
  console.log("[seed] Connected to MongoDB");

  console.log("[seed] Resetting demo collections");
  await resetCollections();

  console.log("[seed] Upserting users");
  const users = await upsertUsers();
  const admin = users.find((user) => user.role === "super_admin");
  const clinicians = users.filter((user) => user.role === "clinician");

  console.log("[seed] Seeding compliance documents and groups");
  const { documentMap, groupMap } = await seedCompliance(admin._id);

  console.log("[seed] Seeding hierarchy and linked documents");
  const { icbMap, federationMap, pcnMap, practiceMap } = await seedHierarchy(admin, clinicians, groupMap, documentMap);

  console.log("[seed] Seeding contact history");
  await seedContactHistory(admin, icbMap, federationMap, pcnMap, practiceMap);

  console.log("[seed] Seeding audit logs");
  await seedAuditLogs(admin, pcnMap, practiceMap);

  console.log("[seed] Seed complete");
  console.log(`[seed] Users: ${users.length}`);
  console.log(`[seed] ICBs: ${icbMap.size}`);
  console.log(`[seed] Federations: ${federationMap.size}`);
  console.log(`[seed] PCNs: ${pcnMap.size}`);
  console.log(`[seed] Practices: ${practiceMap.size}`);
  console.log(`[seed] Compliance documents: ${documentMap.size}`);
  console.log(`[seed] Document groups: ${groupMap.size}`);
  console.log(`[seed] Contact history entries: ${await ContactHistory.countDocuments()}`);
  console.log(`[seed] Audit logs: ${await AuditLog.countDocuments()}`);
}

main()
  .catch((err) => {
    console.error("[seed] Failed:", err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
