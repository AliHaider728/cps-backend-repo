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

import { Request, Response, NextFunction } from "express";
import PCN from "../models/PCN.js";
import Practice from "../models/Practice.js";
import { logAudit } from "../middleware/auditLogger.js";
import { createId, isValidId } from "../lib/ids.js";

/* ── helpers ─────────────────────────────────────────────────────── */
function normalizeEntityType(entityType: string = "") {
  const t = String(entityType).toLowerCase();
  if (t === "pcn") return "PCN";
  if (t === "practice") return "Practice";
  return null;
}

function getModel(entityType: string) {
  if (entityType === "PCN") return PCN;
  if (entityType === "Practice") return Practice;
  throw new Error("Invalid entityType");
}

/* ── GET all reports ─────────────────────────────────────────────── */
export const getReportingArchive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const Model = getModel(normalizedType);
    const entity: any = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const archive = (entity.reportingArchive || [])
      .slice()
      .sort((a: any, b: any) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    return res.json({ archive, total: archive.length, entityName: entity.name });
  } catch (err: any) {
    console.error("getReportingArchive ERROR:", err.message);
    return res.status(500).json({ message: "Failed to fetch reporting archive" });
  }
};

/* ── POST add report ─────────────────────────────────────────────── */
export const addToReportingArchive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const { fileUrl, fileName, mimeType, fileSize, month, year, notes } = req.body;

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

    const Model = getModel(normalizedType);
    const entity = await Model.findById(req.params.entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const newReport = {
      reportId:   createId(),
      month:      monthNum,
      year:       yearNum,
      fileName:   fileName  || "",
      reportUrl:  fileUrl,
      mimeType:   mimeType  || "",
      fileSize:   fileSize  || 0,
      notes:      notes?.trim() || "",
      uploadedAt: new Date(),
      uploadedBy: (req as any).user?._id || null,
      starred:    false,
    };

    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $push: { reportingArchive: newReport } as any },
      { new: true, runValidators: false }
    );

    await logAudit(req as any, "REPORT_UPLOAD", "ReportingArchive", {
      // @ts-ignore
      resourceId: req.params.entityId,
      detail: `${normalizedType} monthly report uploaded (${monthNum}/${yearNum}): ${fileName}`,
      after: { entityType: normalizedType, entityId: req.params.entityId, month: monthNum, year: yearNum },
    });

    const updated: any = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    const archive = (updated.reportingArchive || [])
      .slice()
      .sort((a: any, b: any) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    return res.status(201).json({
      message: "Report uploaded successfully",
      archive,
      total: archive.length,
      entityName: updated.name,
    });
  } catch (err: any) {
    console.error("addToReportingArchive ERROR:", err.message, err.stack);
    return res.status(500).json({ message: "Failed to upload report" });
  }
};

/* ── DELETE remove report ────────────────────────────────────────── */
export const deleteFromReportingArchive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    const normalizedType = normalizeEntityType(req.params.entityType);
    if (!normalizedType) return res.status(400).json({ message: "Invalid entityType" });
    if (!isValidId(String(req.params.entityId || "")))
      return res.status(400).json({ message: "Invalid entity ID" });

    const { reportId } = req.params;
    if (!reportId) return res.status(400).json({ message: "reportId is required" });

    const Model = getModel(normalizedType);
    const entity: any = await Model.findById(req.params.entityId).lean();
    if (!entity) return res.status(404).json({ message: `${normalizedType} not found` });

    const archive = entity.reportingArchive || [];
    const reportEntry = archive.find((r: any) => String(r.reportId || r._id) === String(reportId));
    if (!reportEntry) return res.status(404).json({ message: "Report not found in archive" });

    await Model.findByIdAndUpdate(
      req.params.entityId,
      { $pull: { reportingArchive: { reportId: reportId } } as any },
      { runValidators: false }
    );

    await logAudit(req as any, "REPORT_DELETE", "ReportingArchive", {
      // @ts-ignore
      resourceId: req.params.entityId,
      detail: `${normalizedType} monthly report deleted (${reportEntry.month}/${reportEntry.year}): ${reportEntry.fileName}`,
    });

    const updated: any = await Model.findById(req.params.entityId).select("name reportingArchive").lean();
    const updatedArchive = (updated.reportingArchive || [])
      .slice()
      .sort((a: any, b: any) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });

    return res.json({
      message: "Report deleted successfully",
      archive: updatedArchive,
      total: updatedArchive.length,
    });
  } catch (err: any) {
    console.error("deleteFromReportingArchive ERROR:", err.message);
    return res.status(500).json({ message: "Failed to delete report" });
  }
};
