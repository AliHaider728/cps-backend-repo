import { query } from "../config/db.js";
import { calcAllBalances } from "./leaveCalc.js";
import ClinicianLeaveEntry from "../models/ClinicianLeaveEntry.js";

/**
 * Keep SQL `clinicians` stub table in sync with app_records Clinician profile
 * so JOINs and admin reports stay consistent with Supabase PostgreSQL.
 */
export async function syncClinicianStub(clinician = {}) {
  const id = clinician._id || clinician.id;
  if (!id) return;

  let leaveBalances = clinician.leave_balances;
  if (!Array.isArray(leaveBalances)) {
    try {
      const entries = await ClinicianLeaveEntry.find({ clinician: id }).lean();
      leaveBalances = calcAllBalances(entries).map((b) => ({
        contract_type: b.contract,
        total_hours: (b.total || 0) * 7.5,
        taken_hours: (b.used || 0) * 7.5,
        remaining_hours: (b.remaining || 0) * 7.5,
      }));
    } catch {
      leaveBalances = [];
    }
  }

  const opsLeadId = clinician.opsLead?._id || clinician.opsLead || null;
  const supervisorId = clinician.supervisor?._id || clinician.supervisor || null;
  const userId = clinician.user?._id || clinician.user || clinician.userId || null;

  await query(
    `INSERT INTO clinicians (
       id, full_name, email, clinician_type, contract_type,
       user_id, smartcard, start_date, end_date,
       ops_lead_id, supervisor_id, leave_balances
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::date, $9::date,
       $10, $11, $12::jsonb
     )
     ON CONFLICT (id) DO UPDATE SET
       full_name       = EXCLUDED.full_name,
       email           = EXCLUDED.email,
       clinician_type  = EXCLUDED.clinician_type,
       contract_type   = EXCLUDED.contract_type,
       user_id         = EXCLUDED.user_id,
       smartcard       = EXCLUDED.smartcard,
       start_date      = EXCLUDED.start_date,
       end_date        = EXCLUDED.end_date,
       ops_lead_id     = EXCLUDED.ops_lead_id,
       supervisor_id   = EXCLUDED.supervisor_id,
       leave_balances  = EXCLUDED.leave_balances`,
    [
      id,
      clinician.fullName || "",
      clinician.email || "",
      clinician.clinicianType || "",
      clinician.contractType || "",
      userId,
      clinician.smartCard || "",
      clinician.startDate ? String(clinician.startDate).slice(0, 10) : null,
      clinician.endDate ? String(clinician.endDate).slice(0, 10) : null,
      opsLeadId,
      supervisorId,
      JSON.stringify(leaveBalances),
    ]
  );
}
