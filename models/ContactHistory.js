import { createModel } from "../lib/model.js";

const ContactHistory = createModel({
  modelName: "ContactHistory",
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

export default ContactHistory;
