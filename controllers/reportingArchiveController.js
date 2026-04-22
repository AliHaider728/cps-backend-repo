/**
 * reportingArchiveController.js
 *
 * ✅ UPDATED: File uploads now use "frontend-to-Supabase" pattern.
 *    POST handler receives plain JSON body:
 *      { fileUrl, fileName, mimeType, fileSize, month, year, notes }
 *    No multer / no FormData. Remove upload.single("file") from this route.
 *
 * Routes:
 *   GET    /api/clients/:entityType/:entityId/reporting-archive
 *   POST   /api/clients/:entityType/:entityId/reporting-archive
 *   DELETE /api/clients/:entityType/:entityId/reporting-archive/:reportId
 */

import PCN      from "../models/PCN.js";
import Practice from "../models/Practice.js";
import { logAudit } from "../middleware/auditLogger.js";
import { createId, isValidId } from "../lib/ids.js";

/* ── helpers ─────────────────────────────────────────────────────── */
function normalizeEntityType(entityType = "") {
  const t = String(entityType).toLowerCase();
  if (t === "pcn")      return "PCN";
  if (t === "practice") return "Practice";
  return null;
}

function getModel(entityType) {
  if (entityType === "PCN")      return PCN;
  if (entityType === "Practice") return Practice;
  throw new Error("Invalid entityType");
}

/* ── GET all reports ─────────────────────────────────────────────── */
export const getReportingArchive = async (req, res) => {
  try {
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const Model  = getModel(normalizedType);
    const entity = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const archive = (entity.reportingArchive || [])
      .slice()
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    res.json({ archive, total: archive.length, entityName: entity.name });
  } catch (err) {
    console.error("getReportingArchive ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch reporting archive" });
  }
};

/* ── POST add report ─────────────────────────────────────────────── */
/**
 * ✅ Accepts JSON body (NOT FormData / multer).
 * Frontend uploads file to Supabase first, then calls this endpoint with metadata.
 *
 * Expected body:
 * {
 *   fileUrl:  string  (Supabase public URL)
 *   fileName: string
 *   mimeType: string
 *   fileSize: number
 *   month:    string | number   (1–12)
 *   year:     string | number
 *   notes:    string (optional)
 * }
 */
export const addToReportingArchive = async (req, res) => {
  try {
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const { fileUrl, fileName, mimeType, fileSize, month, year, notes } = req.body;

    // ✅ Validate required fields
    if (!month || !year) {
      return res.status(400).json({ message: "month and year are required" });
    }
    if (!fileUrl) {
      return res.status(400).json({ message: "fileUrl is required" });
    }
    if (!fileName) {
      return res.status(400).json({ message: "fileName is required" });
    }

    const monthNum = Number(month);
    const yearNum  = Number(year);

    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ message: "month must be between 1 and 12" });
    }
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ message: "year is invalid" });
    }

    const Model  = getModel(normalizedType);
    const entity = await Model.findById(req.params.entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    // Build the new archive entry
    const newReport = {
      reportId:   createId(),
      month:      monthNum,
      year:       yearNum,
      fileName:   fileName  || "",
      reportUrl:  fileUrl,          // stored as reportUrl for consistency with existing schema
      mimeType:   mimeType  || "",
      fileSize:   fileSize  || 0,
      notes:      notes?.trim() || "",
      uploadedAt: new Date(),
      uploadedBy: req.user?._id || null,
      starred:    false,
    };

    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $push: { reportingArchive: newReport } },
      { new: true, runValidators: false }
    );

    await logAudit(req, "REPORT_UPLOAD", "ReportingArchive", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} monthly report uploaded (${monthNum}/${yearNum}): ${fileName}`,
      after: { entityType: normalizedType, entityId: req.params.entityId, month: monthNum, year: yearNum },
    });

    // Return full refreshed archive
    const updated = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    const archive = (updated.reportingArchive || [])
      .slice()
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    res.status(201).json({
      message: "Report uploaded successfully",
      archive,
      total: archive.length,
      entityName: updated.name,
    });
  } catch (err) {
    console.error("addToReportingArchive ERROR:", err.message, err.stack);
    res.status(500).json({ message: "Failed to upload report" });
  }
};

/* ── DELETE remove report ────────────────────────────────────────── */
export const deleteFromReportingArchive = async (req, res) => {
  try {
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const { reportId } = req.params;
    if (!reportId) return res.status(400).json({ message: "reportId is required" });

    const Model  = getModel(normalizedType);
    const entity = await Model.findById(req.params.entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const archive     = entity.reportingArchive || [];
    const reportEntry = archive.find((r) => String(r.reportId || r._id) === String(reportId));
    if (!reportEntry) return res.status(404).json({ message: "Report not found in archive" });

    // Remove from array using $pull on reportId or _id
    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $pull: { reportingArchive: { reportId: reportId } } },
      { runValidators: false }
    );

    await logAudit(req, "REPORT_DELETE", "ReportingArchive", {
      resourceId: req.params.entityId,
      detail: `${normalizedType} monthly report deleted (${reportEntry.month}/${reportEntry.year}): ${reportEntry.fileName}`,
    });

    // Return refreshed archive
    const updated = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    const updatedArchive = (updated.reportingArchive || [])
      .slice()
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    res.json({
      message: "Report deleted successfully",
      archive: updatedArchive,
      total: updatedArchive.length,
    });
  } catch (err) {
    console.error("deleteFromReportingArchive ERROR:", err.message);
    res.status(500).json({ message: "Failed to delete report" });
  }
};