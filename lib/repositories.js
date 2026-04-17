import { createRepository, hashPasswordIfNeeded } from "./recordModel.js";

export const User = createRepository({
  modelName: "User",
  tableModel: "user",
  hiddenFields: ["password"],
  defaults: {
    name: "",
    email: "",
    password: "",
    role: "clinician",
    isActive: true,
    mustChangePassword: false,
    isAnonymised: false,
    createdBy: null,
    lastLogin: null,
  },
  beforeSave: async (document) => {
    if (document.email) {
      document.email = String(document.email).trim().toLowerCase();
    }
    await hashPasswordIfNeeded(document);
  },
});

export const AuditLog = createRepository({
  modelName: "AuditLog",
  tableModel: "audit_log",
  refs: {
    user: { model: "User" },
  },
  defaults: {
    user: null,
    userName: "System",
    userRole: "system",
    action: "",
    resource: "",
    resourceId: null,
    detail: "",
    before: null,
    after: null,
    ip: "",
    userAgent: "",
    status: "success",
  },
});

export const ICB = createRepository({
  modelName: "ICB",
  tableModel: "client",
  fixedData: {
    entityType: "ICB",
  },
  defaults: {
    name: "",
    code: "",
    region: "",
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export const Federation = createRepository({
  modelName: "Federation",
  tableModel: "client",
  fixedData: {
    entityType: "Federation",
  },
  refs: {
    icb: { model: "ICB" },
  },
  defaults: {
    name: "",
    type: "",
    icb: null,
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export const ComplianceDocument = createRepository({
  modelName: "ComplianceDocument",
  tableModel: "compliance_doc",
  fixedData: {
    recordType: "ComplianceDocument",
  },
  defaults: {
    name: "",
    description: "",
    category: "other",
    applicableTo: ["Clinician"],
    displayOrder: 0,
    mandatory: true,
    expirable: false,
    active: true,
    defaultExpiryDays: 365,
    reminderDays: [30, 14, 7, 0],
    autoSendOnBooking: false,
    preStartRequired: false,
    templateFileUrl: "",
    templateFileName: "",
    createdBy: null,
    updatedBy: null,
  },
});

export const DocumentGroup = createRepository({
  modelName: "DocumentGroup",
  tableModel: "compliance_doc",
  fixedData: {
    recordType: "DocumentGroup",
  },
  refs: {
    documents: { model: "ComplianceDocument" },
    createdBy: { model: "User" },
    updatedBy: { model: "User" },
  },
  defaults: {
    name: "",
    description: "",
    displayOrder: 0,
    active: true,
    applicableEntityTypes: ["Clinician"],
    documents: [],
    isPreStartChecklist: false,
    autoAssignOnBooking: false,
    createdBy: null,
    updatedBy: null,
  },
});

export const PCN = createRepository({
  modelName: "PCN",
  tableModel: "client",
  fixedData: {
    entityType: "PCN",
  },
  refs: {
    icb: { model: "ICB" },
    federation: { model: "Federation" },
    complianceGroup: { model: "DocumentGroup" },
    complianceGroups: { model: "DocumentGroup" },
    activeClinicians: { model: "User" },
    restrictedClinicians: { model: "User" },
    createdBy: { model: "User" },
  },
  defaults: {
    name: "",
    icb: null,
    federation: null,
    federationName: "",
    contacts: [],
    annualSpend: 0,
    contractType: "",
    contractStartDate: null,
    contractRenewalDate: null,
    contractExpiryDate: null,
    xeroCode: "",
    xeroCategory: "",
    activeClinicians: [],
    restrictedClinicians: [],
    documents: [],
    emailTemplates: [],
    monthlyMeetings: [],
    requiredSystems: {
      emis: false,
      systmOne: false,
      ice: false,
      accurx: false,
      docman: false,
      softphone: false,
      vpn: false,
      other: "",
    },
    ndaSigned: false,
    dsaSigned: false,
    mouReceived: false,
    gdprAgreement: false,
    welcomePackSent: false,
    govChecklist: false,
    insuranceCert: false,
    complianceDocs: {},
    complianceGroup: null,
    complianceGroups: [],
    groupDocuments: [],
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export const Practice = createRepository({
  modelName: "Practice",
  tableModel: "client",
  fixedData: {
    entityType: "Practice",
  },
  refs: {
    pcn: { model: "PCN" },
    complianceGroup: { model: "DocumentGroup" },
    linkedClinicians: { model: "User" },
    restrictedClinicians: { model: "User" },
    createdBy: { model: "User" },
  },
  defaults: {
    name: "",
    pcn: null,
    odsCode: "",
    patientListSize: 0,
    address: "",
    city: "",
    postcode: "",
    contacts: [],
    linkedClinicians: [],
    restrictedClinicians: [],
    systemAccess: [],
    systemAccessNotes: "",
    contractType: "",
    fte: "",
    contractSignedDate: null,
    xeroCode: "",
    xeroCategory: "",
    cqcRating: false,
    indemnityInsurance: false,
    healthSafety: false,
    gdprPolicy: false,
    informationGovernance: false,
    ndaSigned: false,
    dsaSigned: false,
    mouReceived: false,
    welcomePackSent: false,
    mobilisationPlanSent: false,
    confidentialityFormSigned: false,
    prescribingPoliciesShared: false,
    remoteAccessSetup: false,
    templateInstalled: false,
    reportsImported: false,
    complianceDocs: {},
    complianceGroup: null,
    groupDocuments: [],
    documents: [],
    rotaVisible: true,
    notes: "",
    isActive: true,
    createdBy: null,
    viewedBy: [],
  },
});

export const ContactHistory = createRepository({
  modelName: "ContactHistory",
  tableModel: "client",
  fixedData: {
    recordType: "ContactHistory",
  },
  refs: {
    createdBy: { model: "User" },
  },
  defaults: {
    entityType: "",
    entityId: "",
    type: "note",
    subject: "",
    detail: "",
    outcome: "",
    starred: false,
    contactDate: null,
    emailTracking: null,
    attachments: [],
    createdBy: null,
  },
});
