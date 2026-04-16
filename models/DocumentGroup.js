import { createModel } from "../lib/model.js";

const DocumentGroup = createModel({
  modelName: "DocumentGroup",
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

export default DocumentGroup;
