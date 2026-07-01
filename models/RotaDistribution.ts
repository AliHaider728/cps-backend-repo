// @ts-nocheck
/**
 * models/RotaDistribution.js — Module 5 (Rota Distribution Tracking)
 *
 * Tracks when and to whom rotas are sent.
 * client_id → TEXT (Xero code or UUID)
 *
 *   recipient_emails passed as plain array (not JSON.stringify)
 *         PostgreSQL TEXT[] accepts JS arrays directly via pg driver.
 */

import { query } from "../config/db.js";

class RotaDistribution {
  static async create(data = {}) {
    const {
      client_id        = null,
      client_name      = "",
      month            = null,
      year             = null,
      sent_by          = null,
      recipient_emails = [],
    } = data;

    if (!client_id || !month || !year) {
      const err = new Error("client_id, month, and year are required");
      err.statusCode = 400;
      throw err;
    }

    const result = await query(
      `INSERT INTO rota_distributions (
        client_id, client_name, month, year, sent_by, recipient_emails
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (client_id, month, year) DO UPDATE SET
        sent_by          = EXCLUDED.sent_by,
        sent_at          = NOW(),
        recipient_emails = EXCLUDED.recipient_emails,
        client_name      = COALESCE(EXCLUDED.client_name, rota_distributions.client_name)
      RETURNING *`,
      //  Pass array directly — pg driver handles TEXT[] natively
      [client_id, client_name, month, year, sent_by, recipient_emails]
    );

    return this._mapRow(result.rows[0]);
  }

  static async findById(id) {
    const result = await query(
      `SELECT * FROM rota_distributions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return this._mapRow(result.rows[0]);
  }

  static async find(filter = {}) {
    let sql = `SELECT * FROM rota_distributions WHERE 1=1`;
    const params = [];
    let i = 1;

    if (filter.client_id) { sql += ` AND client_id = $${i++}`; params.push(filter.client_id); }
    if (filter.month && filter.year) {
      sql += ` AND month = $${i++} AND year = $${i++}`;
      params.push(filter.month, filter.year);
    }

    sql += ` ORDER BY sent_at DESC`;
    const result = await query(sql, params);
    return result.rows.map((row) => this._mapRow(row));
  }

  static async findByClientId(clientId, limit = 12) {
    const result = await query(
      `SELECT * FROM rota_distributions
       WHERE client_id = $1
       ORDER BY sent_at DESC
       LIMIT $2`,
      [clientId, limit]
    );
    return result.rows.map((row) => this._mapRow(row));
  }

  static async findByMonth(month, year) {
    const result = await query(
      `SELECT * FROM rota_distributions
       WHERE month = $1 AND year = $2
       ORDER BY sent_at DESC`,
      [month, year]
    );
    return result.rows.map((row) => this._mapRow(row));
  }

  static async findByIdAndUpdate(id, data = {}) {
    const updates = { ...data };
    delete updates.id;
    delete updates._id;
    delete updates.created_at;

    const keys = Object.keys(updates);
    if (keys.length === 0) return this.findById(id);

    let sql = `UPDATE rota_distributions SET`;
    const params = [];
    let i = 1;

    for (let k = 0; k < keys.length; k++) {
      if (k > 0) sql += `,`;
      sql += ` ${keys[k]} = $${i++}`;
      params.push(updates[keys[k]]); //  arrays passed directly
    }

    sql += ` WHERE id = $${i++} RETURNING *`;
    params.push(id);

    const result = await query(sql, params);
    return this._mapRow(result.rows[0]);
  }

  static async findByIdAndDelete(id) {
    const result = await query(
      `DELETE FROM rota_distributions WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows.length > 0;
  }

  static async isSent(clientId, month, year) {
    const result = await query(
      `SELECT 1 FROM rota_distributions
       WHERE client_id = $1 AND month = $2 AND year = $3
       LIMIT 1`,
      [clientId, month, year]
    );
    return result.rows.length > 0;
  }

  static async getStats() {
    const result = await query(
      `SELECT
        COUNT(*)                              AS total,
        COUNT(DISTINCT client_id)             AS unique_clients,
        MAX(sent_at)                          AS last_sent,
        AVG(array_length(recipient_emails,1)) AS avg_recipients
       FROM rota_distributions`
    );
    const row = result.rows[0] || {};
    return {
      total:          parseInt(row.total          || 0, 10),
      unique_clients: parseInt(row.unique_clients  || 0, 10),
      last_sent:      row.last_sent || null,
      avg_recipients: parseFloat(row.avg_recipients || 0).toFixed(1),
    };
  }

  static _mapRow(row) {
    if (!row) return null;
    return {
      id:               row.id,
      _id:              row.id,
      client_id:        row.client_id,
      client_name:      row.client_name,
      month:            row.month,
      year:             row.year,
      sent_by:          row.sent_by,
      sent_at:          row.sent_at?.toISOString() || row.sent_at,
      //  handles both native pg array and legacy JSON string
      recipient_emails: Array.isArray(row.recipient_emails)
        ? row.recipient_emails
        : typeof row.recipient_emails === "string"
        ? JSON.parse(row.recipient_emails)
        : [],
    };
  }

  static async findLean(filter = {}) {
    return this.find(filter);
  }
}

export default RotaDistribution;