import { createModel } from "../lib/model.js";

/**
 * ClinicianComplianceDoc — per-clinician compliance document record.
 * Stored in `app_records` with model = "ClinicianComplianceDoc".
 *
 * Mirrors backend/sql/clinicians/002_clinician_compliance_docs.sql
 */

const ClinicianComplianceDoc = createModel({
  modelName: "ClinicianComplianceDoc",
  refs: {
    clinician:  { model: "Clinician" },
    approvedBy: { model: "User" },
    rejectedBy: { model: "User" },
  },
  defaults: {
    clinician:    null,
    docName:      "",                  // e.g. "DBS Certificate"
    docKey:       "",                  // optional stable slug for the doc type
    status:       "missing",           // missing | uploaded | approved | expired | rejected
    fileUrl:      "",
    fileName:     "",
    storagePath:  "",
    bucket:       "",
    expiryDate:   null,
    mandatory:    true,
    uploadedBy:   "clinician",         // "clinician" | "ops"
    uploadedAt:   null,
    approvedBy:   null,
    approvedAt:   null,
    rejectedBy:   null,
    rejectedAt:   null,
    rejectReason: "",
    notes:        "",
  },
});

export default ClinicianComplianceDoc;
