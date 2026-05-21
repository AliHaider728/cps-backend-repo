import { query } from "../config/db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept UUID or any non-empty clinician record id (app_records / legacy). */
export function normalizeClinicianId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * Resolve the Clinician record id for a logged-in clinician user.
 * Never returns the User account id — only a linked clinician profile id.
 */
export async function resolveClinicianIdForUser(user) {
  if (!user || user.role !== "clinician") return null;

  const existing =
    normalizeClinicianId(user.clinicianId) ||
    normalizeClinicianId(user.clinician_id);
  if (existing) return existing;

  const userId = String(user._id || user.id || "").trim();
  const email = String(user.email || "").toLowerCase().trim();

  if (userId) {
    try {
      const legacy = await query(
        `SELECT id FROM app_records
          WHERE model = 'Clinician'
            AND (
              data->>'user' = $1
              OR data->>'userId' = $1
              OR data->>'user' = $2
              OR data->>'userId' = $2
            )
          LIMIT 1`,
        [userId, userId]
      );
      if (legacy.rows[0]?.id) return String(legacy.rows[0].id);
    } catch (e) {
      console.warn("[resolveClinicianIdForUser] app_records lookup:", e.message);
    }

    try {
      const byUserId = await query(
        `SELECT id FROM clinicians WHERE user_id::text = $1 LIMIT 1`,
        [userId]
      );
      if (byUserId.rows[0]?.id) return String(byUserId.rows[0].id);
    } catch (_) {
      /* clinicians.user_id may not exist */
    }
  }

  if (email) {
    try {
      const byEmail = await query(
        `SELECT id FROM app_records
          WHERE model = 'Clinician'
            AND LOWER(COALESCE(data->>'email', '')) = $1
          LIMIT 1`,
        [email]
      );
      if (byEmail.rows[0]?.id) return String(byEmail.rows[0].id);
    } catch (e) {
      console.warn("[resolveClinicianIdForUser] email lookup:", e.message);
    }

    try {
      const byEmailSql = await query(
        `SELECT id FROM clinicians WHERE LOWER(email) = $1 LIMIT 1`,
        [email]
      );
      if (byEmailSql.rows[0]?.id) return String(byEmailSql.rows[0].id);
    } catch (_) {}
  }

  return null;
}

export async function attachClinicianIdToUser(user) {
  if (!user || user.role !== "clinician") return user;
  const clinicianId = await resolveClinicianIdForUser(user);
  if (clinicianId) user.clinicianId = clinicianId;
  return user;
}

export function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}
