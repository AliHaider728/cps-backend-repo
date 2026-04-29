/**
 * lib/leaveCalc.js — Module 3
 *
 * Per-contract annual-leave allowance and balance calculation.
 *
 * Default annual allowances (full-time pro-rated days):
 *   ARRS   → 28 days
 *   EA     → 25 days
 *   Direct → 30 days
 *
 * `entries` is the full list of ClinicianLeaveEntry records for the clinician.
 * Only entries that are:
 *   - leaveType === "annual"
 *   - approved === true
 *   - matching the requested contract
 * are counted toward "used".
 */

const DEFAULT_ALLOWANCE = { ARRS: 28, EA: 25, Direct: 30 };

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const calcLeaveBalance = (entries = [], contractType = "ARRS") => {
  const total = DEFAULT_ALLOWANCE[contractType] ?? 28;
  const used = entries
    .filter(
      (e) =>
        e &&
        e.contract === contractType &&
        e.leaveType === "annual" &&
        e.approved === true
    )
    .reduce((sum, e) => sum + toNumber(e.days), 0);

  return {
    contract:  contractType,
    total,
    used:      Math.round(used * 10) / 10,
    remaining: Math.round((total - used) * 10) / 10,
  };
};

export const calcAllBalances = (entries = []) =>
  ["ARRS", "EA", "Direct"].map((contract) => calcLeaveBalance(entries, contract));

/**
 * Counts non-annual leave (sick / cppe / other) — useful for the calendar tab.
 */
export const calcOtherLeave = (entries = []) => {
  const buckets = { sick: 0, cppe: 0, other: 0 };
  for (const e of entries || []) {
    if (!e || e.leaveType === "annual") continue;
    const key = ["sick", "cppe"].includes(e.leaveType) ? e.leaveType : "other";
    buckets[key] += toNumber(e.days);
  }
  return buckets;
};

/**
 * Inclusive day count between two ISO date strings (YYYY-MM-DD).
 * Returns 0 when inputs are invalid or end < start.
 */
export const dayCount = (startISO, endISO) => {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO);
  const end   = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
};

export default {
  calcLeaveBalance,
  calcAllBalances,
  calcOtherLeave,
  dayCount,
  DEFAULT_ALLOWANCE,
};
