import { Request, Response } from "express";
import * as xeroService from "../services/xeroService.js";
import { query } from "../config/db.js";
import crypto from "crypto";

// Helper for normalize
function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase();
}

export async function connectXero(req: Request, res: Response) {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const url = await xeroService.getAuthUrl(state);
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function callbackXero(req: Request, res: Response) {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send("No code provided by Xero.");
    }
    const userId = (req as any).user?.id || null;
    await xeroService.exchangeCode(code as string, userId);

    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard/xero`);
  } catch (error: any) {
    res.status(500).send(`Failed to connect to Xero: ${error.message}`);
  }
}

export async function getXeroStatus(req: Request, res: Response) {
  try {
    const conn = await xeroService.getConnection();
    if (!conn) {
      return res.json({ connected: false });
    }
    
    // Check if valid token
    const isValid = new Date(conn.expires_at).getTime() > Date.now();
    
    res.json({
      connected: true,
      tenantId: conn.tenant_id,
      tenantName: conn.tenant_name,
      updatedAt: conn.updated_at,
      isValid,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function disconnectXero(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id || null;
    await xeroService.disconnectXero(userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function getContacts(req: Request, res: Response) {
  try {
    const contacts = await xeroService.getContacts();
    res.json(contacts);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function getSyncStatus(req: Request, res: Response) {
  try {
    const practicesRes = await query(`SELECT id, name, xero_contact_id, data->>'xeroCode' as xero_code, data->>'xeroCategory' as xero_category, 'practice' as type FROM practices`);
    const pcnsRes = await query(`SELECT id, name, xero_contact_id, data->>'xeroCode' as xero_code, data->>'xeroCategory' as xero_category, 'pcn' as type FROM pcns`);
    const internalRecords = [...practicesRes.rows, ...pcnsRes.rows];

    let xeroContacts: any[] = [];
    let connected = false;
    try {
      xeroContacts = await xeroService.getContacts();
      connected = true;
    } catch (e) {
      // Not connected
    }

    // Process matching
    const mappedRecords = internalRecords.map((rec: any) => {
      let matchStatus = "Unsynced";
      let xeroContact = null;

      if (connected) {
        if (rec.xero_contact_id) {
          xeroContact = xeroContacts.find((c: any) => c.ContactID === rec.xero_contact_id);
          if (!xeroContact) {
            matchStatus = "Missing in Xero";
          } else {
            const localName = normalizeName(rec.name);
            const remoteName = normalizeName(xeroContact.Name);
            if (localName === remoteName) {
              matchStatus = "Matched";
            } else {
              matchStatus = "Out of Sync";
            }
          }
        } else {
          // Check if we can find by name
          const localName = normalizeName(rec.name);
          const potentialMatch = xeroContacts.find((c: any) => normalizeName(c.Name) === localName);
          if (potentialMatch) {
            // It's in Xero, but we don't have the contact ID saved.
            matchStatus = "Out of Sync"; 
            xeroContact = potentialMatch;
          }
        }
      }

      return {
        ...rec,
        matchStatus,
        xeroContactName: xeroContact ? xeroContact.Name : null,
      };
    });

    // Find Xero Only
    const localContactIds = new Set(internalRecords.map(r => r.xero_contact_id).filter(Boolean));
    const localNames = new Set(internalRecords.map(r => normalizeName(r.name)));
    const xeroOnly = xeroContacts.filter(c => 
      !localContactIds.has(c.ContactID) && !localNames.has(normalizeName(c.Name))
    ).map(c => ({
      id: c.ContactID,
      type: "xero_only",
      name: c.Name,
      xero_contact_id: c.ContactID,
      matchStatus: "Xero Only",
      xeroContactName: c.Name,
    }));

    const allRecords = [...mappedRecords, ...xeroOnly];

    res.json({
      records: allRecords,
      stats: {
        totalXeroContacts: xeroContacts.length,
        matched: mappedRecords.filter(r => r.matchStatus === "Matched").length,
        unmatched: mappedRecords.filter(r => r.matchStatus === "Out of Sync" || r.matchStatus === "Missing in Xero" || r.matchStatus === "Unsynced").length + xeroOnly.length,
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function syncContact(req: Request, res: Response) {
  try {
    const { id, type, name, xeroCode } = req.body;
    if (!id || !type || !name) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const userId = (req as any).user?.id || null;
    const contact = await xeroService.syncContact({
      name,
      contactNumber: xeroCode, 
    }, userId);

    const contactId = contact.ContactID;

    if (type !== "xero_only") {
      const table = type === "pcn" ? "pcns" : "practices";
      await query(`UPDATE ${table} SET xero_contact_id = $1 WHERE id = $2`, [contactId, id]);
    }

    res.json({ success: true, contact });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}

export async function getAuditLog(req: Request, res: Response) {
  try {
    const logRes = await query(`
      SELECT l.*, u.first_name, u.last_name 
      FROM xero_audit_log l
      LEFT JOIN users u ON l.performed_by = u.id
      ORDER BY l.created_at DESC 
      LIMIT 100
    `);
    
    const logs = logRes.rows.map(r => ({
      ...r,
      user_name: r.first_name ? `${r.first_name} ${r.last_name}` : "System"
    }));

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
}