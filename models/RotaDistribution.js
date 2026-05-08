/**
 * models/RotaDistribution.js — Module 5 (Rota Distribution Tracking)
 *
 * Tracks when and to whom rotas are sent.
 * Stores distribution history for audit trail and client communication log.
 */

import { query } from "../config/db.js";

class RotaDistribution {
  /**
   * Create a new rota distribution record.
   * @param {Object} data - Distribution data
   * @returns {Promise<Object>} Created distribution
   */
  static async create(data = {}) {
    const {
      client_id = null,           // TEXT: Xero code or UUID
      client_name = "",           // Client name (fallback)
      month = null,               // 1-12
      year = null,                // 2020+
      sent_by = null,             // UUID: user who sent
      recipient_emails = [],      // String array: recipients
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
      ON CONFLICT (client_id, month, year)
      DO UPDATE SET
        sent_by = EXCLUDED.sent_by,
        sent_at = NOW(),
        recipient_emails = EXCLUDED.recipient_emails
      RETURNING *`,
      [client_id, client_name, month, year, sent_by, JSON.stringify(recipient_emails)]
    );

    return this._mapRow(result.rows[0]);
  }

  /**
   * Find distribution by ID.
   * @param {string} id - Distribution UUID
   * @returns {Promise<Object|null>} Distribution or null
   */
  static async findById(id) {
    const result = await query(
      `SELECT * FROM rota_distributions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return this._mapRow(result.rows[0]);
  }

  /**
   * Find distributions with filters.
   * @param {Object} filter - Filter object
   * @returns {Promise<Array>} Matching distributions
   */
  static async find(filter = {}) {
    let sql = `SELECT * FROM rota_distributions WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (filter.client_id) {
      sql += ` AND client_id = $${paramIndex++}`;
      params.push(filter.client_id);
    }
    if (filter.month && filter.year) {
      sql += ` AND month = $${paramIndex++} AND year = $${paramIndex++}`;
      params.push(filter.month, filter.year);
    }

    sql += ` ORDER BY sent_at DESC`;

    const result = await query(sql, params);
    return result.rows.map((row) => this._mapRow(row));
  }

  /**
   * Get distribution history for a client.
   * @param {string} clientId - Client identifier
   * @param {number} limit - Number of records
   * @returns {Promise<Array>} Last N distributions
   */
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

  /**
   * Get distributions for a specific month/year.
   * @param {number} month - Month (1-12)
   * @param {number} year - Year
   * @returns {Promise<Array>} All distributions for that month
   */
  static async findByMonth(month, year) {
    const result = await query(
      `SELECT * FROM rota_distributions
       WHERE month = $1 AND year = $2
       ORDER BY sent_at DESC`,
      [month, year]
    );
    return result.rows.map((row) => this._mapRow(row));
  }

  /**
   * Update distribution record.
   * @param {string} id - Distribution UUID
   * @param {Object} data - Fields to update
   * @returns {Promise<Object|null>} Updated distribution
   */
  static async findByIdAndUpdate(id, data = {}) {
    const updates = { ...data };
    delete updates.id;
    delete updates._id;
    delete updates.created_at;

    const keys = Object.keys(updates);
    if (keys.length === 0) return this.findById(id);

    let sql = `UPDATE rota_distributions SET`;
    const params = [];
    let paramIndex = 1;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i > 0) sql += `,`;
      sql += ` ${key} = $${paramIndex++}`;
      
      // Handle JSON arrays
      if (Array.isArray(updates[key])) {
        params.push(JSON.stringify(updates[key]));
      } else {
        params.push(updates[key]);
      }
    }

    sql += ` WHERE id = $${paramIndex++} RETURNING *`;
    params.push(id);

    const result = await query(sql, params);
    return this._mapRow(result.rows[0]);
  }

  /**
   * Delete distribution.
   * @param {string} id - Distribution UUID
   * @returns {Promise<boolean>} True if deleted
   */
  static async findByIdAndDelete(id) {
    const result = await query(
      `DELETE FROM rota_distributions WHERE id = $1 RETURNING id`,
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Check if rota has been sent for a client/month/year.
   * @param {string} clientId - Client ID
   * @param {number} month - Month
   * @param {number} year - Year
   * @returns {Promise<boolean>} True if sent
   */
  static async isSent(clientId, month, year) {
    const result = await query(
      `SELECT 1 FROM rota_distributions
       WHERE client_id = $1 AND month = $2 AND year = $3
       LIMIT 1`,
      [clientId, month, year]
    );
    return result.rows.length > 0;
  }

  /**
   * Get distribution statistics.
   * @returns {Promise<Object>} Stats (total sent, by month, etc.)
   */
  static async getStats() {
    const result = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(DISTINCT client_id) as unique_clients,
        MAX(sent_at) as last_sent,
        AVG(array_length(recipient_emails, 1)) as avg_recipients
       FROM rota_distributions`
    );
    return {
      total: parseInt(result.rows[0]?.total || 0, 10),
      unique_clients: parseInt(result.rows[0]?.unique_clients || 0, 10),
      last_sent: result.rows[0]?.last_sent,
      avg_recipients: parseFloat(result.rows[0]?.avg_recipients || 0).toFixed(1),
    };
  }

  /**
   * Map database row to distribution object.
   * @private
   */
  static _mapRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      _id: row.id,
      client_id: row.client_id,
      client_name: row.client_name,
      month: row.month,
      year: row.year,
      sent_by: row.sent_by,
      sent_at: row.sent_at?.toISOString() || row.sent_at,
      recipient_emails: Array.isArray(row.recipient_emails)
        ? row.recipient_emails
        : typeof row.recipient_emails === "string"
        ? JSON.parse(row.recipient_emails)
        : [],
    };
  }

  /**
   * Lean query (read-only, faster).
   * @param {Object} filter - Filter object
   * @returns {Promise<Array>}
   */
  static async findLean(filter = {}) {
    return this.find(filter);
  }
}

export default RotaDistribution;