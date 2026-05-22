import { calcLeaveBalance, dayCount } from "./leaveCalc.js";

/**
 * Hard block when annual leave exceeds remaining days for contract type (Blueprint Rule #01).
 */
export function validateAnnualLeaveBalance(existingEntries = [], { contract, startDate, endDate, days }) {
  const contractType = contract || "ARRS";
  const requestedDays =
    days != null && days !== ""
      ? Number(days)
      : dayCount(startDate, endDate);

  if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
    return {
      blocked: true,
      code: "HARD_BLOCK",
      message: "Invalid leave duration.",
    };
  }

  const balance = calcLeaveBalance(existingEntries, contractType);
  const remaining = Number(balance.remaining ?? 0);

  if (requestedDays > remaining + 0.001) {
    return {
      blocked: true,
      code: "HARD_BLOCK",
      message: `You do not have enough ${contractType} annual leave. Requested: ${requestedDays} day(s), remaining: ${remaining} day(s).`,
      contractType,
      requestedDays,
      remainingDays: remaining,
    };
  }

  return { blocked: false, requestedDays, remainingDays: remaining };
}
