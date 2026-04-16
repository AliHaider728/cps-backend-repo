import { createModel } from "../lib/model.js";

const AuditLog = createModel({
  modelName: "AuditLog",
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

export default AuditLog;
