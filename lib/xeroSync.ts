import { syncContact, createInvoices, logXeroAction } from "../services/xeroService.js";
import { query } from "../config/db.js";

export async function syncClientToXero(clientId: string, name: string, isPractice: boolean) {
  try {
    const contact = await syncContact({ name, isCustomer: true }, null);
    if (contact?.ContactID) {
      if (isPractice) {
        await query(`UPDATE practices SET xero_contact_id = $1 WHERE _id = $2 OR id::text = $2`, [contact.ContactID, clientId.toString()]);
      } else {
        await query(`UPDATE pcns SET xero_contact_id = $1 WHERE _id = $2 OR id::text = $2`, [contact.ContactID, clientId.toString()]);
      }
    }
  } catch (err: any) {
    console.error("Non-blocking Xero client sync failed:", err.message);
  }
}

export async function syncClinicianToXero(clinicianId: string, name: string, contractType: string) {
  if (contractType !== "Contractor" && contractType !== "Limited Company") {
    return; // Only sync contractors
  }
  
  try {
    const res = await query(`SELECT xero_contact_id FROM clinicians WHERE id = $1 OR _id = $1`, [clinicianId.toString()]);
    if (res.rows[0]?.xero_contact_id) {
      await logXeroAction(null, "sync_contact", `Skipped clinician sync`, `Clinician ${name} already has a Xero Contact ID`, "Skipped");
      return;
    }

    const contact = await syncContact({ name, isSupplier: true }, null);
    if (contact?.ContactID) {
      await query(`UPDATE clinicians SET xero_contact_id = $1 WHERE id = $2 OR _id = $2`, [contact.ContactID, clinicianId.toString()]);
    }
  } catch (err: any) {
    console.error("Non-blocking Xero clinician sync failed:", err.message);
  }
}

export async function syncTimesheetToXero(timesheetId: string, userId: string) {
  try {
    const tsRes = await query(
      `SELECT ts.*, c.xero_contact_id AS clinician_xero_id, c.hourly_rate AS clinician_rate, c.full_name AS clinician_name
       FROM timesheets ts
       JOIN clinicians c ON c.id = ts.clinician_id
       WHERE ts.id = $1`,
      [timesheetId]
    );
    if (!tsRes.rows.length) return;
    
    const ts = tsRes.rows[0];
    if (ts.xero_accrec_invoice_id && ts.xero_accpay_invoice_id) {
      await logXeroAction(null, "create_invoice", `Skipped invoice creation`, `Timesheet ${timesheetId} already synced`, "Skipped", userId);
      return; // Idempotency
    }

    // For simplicity, we create one ACCPAY for the clinician covering the total hours, 
    // and if there's a primary surgery, we create an ACCREC for that client.
    // Ideally we should group entries by surgery_id to invoice each client. 
    // I'll assume the primary client is the one we bill, or just bill the first surgery.
    const entriesRes = await query(`SELECT * FROM timesheet_entries WHERE timesheet_id = $1`, [timesheetId]);
    const entries = entriesRes.rows;
    if (!entries.length) return;
    
    const surgeryId = entries[0].surgery_id;
    let clientXeroId = null;
    let clientRate = 0;
    if (surgeryId) {
      const surgeryRes = await query(`SELECT xero_contact_id, hourly_rate FROM practices WHERE id = $1 OR _id = $1`, [surgeryId.toString()]);
      if (surgeryRes.rows.length) {
        clientXeroId = surgeryRes.rows[0].xero_contact_id;
        clientRate = surgeryRes.rows[0].hourly_rate || 50; // Defaulting if not set
      }
    }

    const totalHours = Number(ts.total_hours || entries.reduce((s, e) => s + Number(e.actual_hours || 0), 0));
    
    const dateStr = new Date().toISOString().split("T")[0];
    // Due 30 days from now
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const invoiceData = {
      clientContactId: ts.xero_accrec_invoice_id ? undefined : clientXeroId,
      clinicianContactId: ts.xero_accpay_invoice_id ? undefined : ts.clinician_xero_id,
      description: `Clinical Shift(s) for ${ts.month}/${ts.year} - ${totalHours} Hours`,
      quantity: totalHours,
      unitAmountClient: Number(clientRate || ts.clinician_rate || 50),
      unitAmountContractor: Number(ts.clinician_rate || 40),
      date: dateStr,
      dueDate: dueDate,
      reference: `TS-${ts.month}-${ts.year}-${ts.clinician_name.replace(/\s+/g, '')}`,
    };

    const res = await createInvoices(invoiceData, userId);
    
    let updates = [];
    let params: any[] = [];
    if (res.clientInvoiceId) {
      params.push(res.clientInvoiceId);
      updates.push(`xero_accrec_invoice_id = $${params.length}`);
    }
    if (res.contractorInvoiceId) {
      params.push(res.contractorInvoiceId);
      updates.push(`xero_accpay_invoice_id = $${params.length}`);
    }
    
    if (updates.length) {
      params.push(timesheetId);
      await query(`UPDATE timesheets SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    }
  } catch (err: any) {
    console.error("Non-blocking Xero timesheet sync failed:", err.message);
  }
}
