import { createModel } from "../lib/model.js";

const ComplianceDocument = createModel({
  modelName: "ComplianceDocument",
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

export default ComplianceDocument;
