-- =============================================================================
-- sql/xero/004_add_xero_invoice_ids.sql
-- =============================================================================

ALTER TABLE timesheets 
ADD COLUMN IF NOT EXISTS xero_accrec_invoice_id TEXT,
ADD COLUMN IF NOT EXISTS xero_accpay_invoice_id TEXT;

ALTER TABLE clinicians
ADD COLUMN IF NOT EXISTS xero_contact_id TEXT;
