/**
 * ══════════════════════════════════════════════════════════════════
 * RATE & CONTRACT HISTORY — Add this block to clientController.js
 * ══════════════════════════════════════════════════════════════════
 *
 * WHERE TO PASTE:
 *   1. The `trackFieldChanges` helper goes near your other helpers
 *      (e.g. right after `formatComplianceGroupDetail`).
 *   2. The call to `trackFieldChanges(...)` goes inside `updatePCN`,
 *      right BEFORE the `PCN.findByIdAndUpdate(...)` call (see marked
 *      spot below — you already have `existing` loaded there).
 *   3. The two new exported functions (`getPCNRateHistory` and
 *      `getAllPCNRateSummary`) go anywhere in the PCN CRUD section —
 *      e.g. right after `getPCNRollup`.
 */

import { Request, Response, NextFunction } from "express";

/* ── Helper: tracks changes to rate/contract fields ─────────────────
   Call this BEFORE you run the update, while you still have `existing`
   (the pre-update PCN doc) and `payload` (the incoming update body).
   It mutates `payload` to inject the new `hourlyRateHistory` array,
   so it must run before `PCN.findByIdAndUpdate(...)`.
──────────────────────────────────────────────────────────────────── */
const TRACKED_FIELDS = [
  { key: "hourlyRate",           label: "Hourly Rate"      },
  { key: "contractStartDate",    label: "Contract Start"   },
  { key: "contractRenewalDate",  label: "Renewal Date"     },
  { key: "contractExpiryDate",   label: "Expiry Date"      },
];

const trackFieldChanges = (existing: any, payload: any, userId: any) => {
  const newEntries = [];

  for (const { key, label } of TRACKED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;

    const oldVal = existing[key] ?? null;
    const newVal = payload[key] ?? null;

    // Normalize dates/numbers for comparison so we don't log false-positive
    // "changes" when the value is functionally identical (e.g. "10" vs 10,
    // or same date in different string formats).
    const normalize = (v: any) => {
      if (v === null || v === undefined || v === "") return null;
      if (key === "hourlyRate") return Number(v);
      return new Date(v).toISOString().split("T")[0]; // date-only compare
    };

    const oldNorm = normalize(oldVal);
    const newNorm = normalize(newVal);

    if (oldNorm === newNorm) continue; // no real change — skip

    newEntries.push({
      field:      key,
      fieldLabel: label,
      oldValue:   oldVal,
      newValue:   newVal,
      changedAt:  new Date(),
      changedBy:  userId,
    });
  }

  if (newEntries.length > 0) {
    payload.hourlyRateHistory = [
      ...(existing.hourlyRateHistory || []),
      ...newEntries,
    ];
  }

  return newEntries; // useful if you want to log/audit count
};

/* ══════════════════════════════════════════════════════════════════
   GET /pcn/:id/rate-history
   Returns full chronological history for ONE client + current values
══════════════════════════════════════════════════════════════════ */
export const getPCNRateHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    validateObjectIdOr400(req.params.id, "PCN id");

    // @ts-ignore
    const pcn = await PCN.findById(req.params.id)
      .select("name hourlyRate contractType contractStartDate contractRenewalDate contractExpiryDate hourlyRateHistory")
      .populate("hourlyRateHistory.changedBy", "name role")
      .lean();

    if (!pcn) return res.status(404).json({ message: "PCN not found" });

    const history = [...(pcn.hourlyRateHistory || [])].sort(
      (a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
    );

    res.json({
      entityName: pcn.name,
      current: {
        hourlyRate:          pcn.hourlyRate,
        contractType:        pcn.contractType,
        contractStartDate:   pcn.contractStartDate,
        contractRenewalDate: pcn.contractRenewalDate,
        contractExpiryDate:  pcn.contractExpiryDate,
      },
      history,
    });
  } catch (err: any) {
    console.error("getPCNRateHistory ERROR:", err.message);
    res.status(err.statusCode || 500).json({
      message: err.statusCode ? err.message : "Failed to fetch rate history",
    });
  }
};

/* ══════════════════════════════════════════════════════════════════
   GET /pcn/rate-history/summary
   Returns ALL clients with current rate/dates + their last change +
   total history count. Powers the list page (sidebar tab).
══════════════════════════════════════════════════════════════════ */
export const getAllPCNRateSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // @ts-ignore
    const pcns = await PCN.find({ isActive: true })
      .select("name icb hourlyRate contractType contractStartDate contractRenewalDate contractExpiryDate hourlyRateHistory")
      .populate("icb", "name")
      .sort({ name: 1 })
      .lean();

    const summary = pcns.map((pcn: any) => {
      const history = [...(pcn.hourlyRateHistory || [])].sort(
        (a: any, b: any) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
      );
      const lastChange = history[0] || null;

      return {
        _id:                 pcn._id,
        name:                pcn.name,
        icbName:             pcn.icb?.name || null,
        contractType:        pcn.contractType,
        hourlyRate:          pcn.hourlyRate,
        contractStartDate:   pcn.contractStartDate,
        contractRenewalDate: pcn.contractRenewalDate,
        contractExpiryDate:  pcn.contractExpiryDate,
        historyCount:        history.length,
        lastChange,
      };
    });

    res.json({ clients: summary, total: summary.length });
  } catch (err: any) {
    console.error("getAllPCNRateSummary ERROR:", err.message);
    res.status(500).json({ message: "Failed to fetch rate summary" });
  }
};
