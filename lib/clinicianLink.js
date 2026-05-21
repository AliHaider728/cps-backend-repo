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

/**
 * Link a User account to a Clinician profile (super admin).
 * Updates app_records Clinician.data.user / userId and optional user.data.clinicianId.
 */
export async function linkUserToClinician(userId, clinicianId) {
  const uid = String(userId || "").trim();
  const cid = normalizeClinicianId(clinicianId);
  if (!uid || !cid) {
    const err = new Error("userId and clinicianId are required");
    err.statusCode = 400;
    throw err;
  }

  const userRow = await query(
    `SELECT id, data FROM app_records WHERE model = 'user' AND id = $1 LIMIT 1`,
    [uid]
  );
  if (!userRow.rows[0]) {
    const err = new Error("User not found");
    err.statusCode = 404;
    throw err;
  }

  const clinicianRow = await query(
    `SELECT id, data FROM app_records WHERE model = 'Clinician' AND id = $1 LIMIT 1`,
    [cid]
  );
  if (!clinicianRow.rows[0]) {
    const err = new Error("Clinician not found");
    err.statusCode = 404;
    throw err;
  }

  const clinicianData = clinicianRow.rows[0].data || {};
  const timestamp = new Date().toISOString();

  await query(
    `UPDATE app_records
        SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE model = 'Clinician' AND id = $1`,
    [
      cid,
      JSON.stringify({
        user: uid,
        userId: uid,
        email: clinicianData.email || userRow.rows[0].data?.email || "",
        updatedAt: timestamp,
      }),
    ]
  );

  await query(
    `UPDATE app_records
        SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE model = 'user' AND id = $1`,
    [
      uid,
      JSON.stringify({
        clinicianId: cid,
        clinician_id: cid,
        updatedAt: timestamp,
      }),
    ]
  );

  try {
    await query(
      `UPDATE clinicians SET user_id = $1::uuid WHERE id::text = $2`,
      [isUuid(uid) ? uid : null, cid]
    );
  } catch (_) {
    /* stub clinicians table may lack user_id */
  }

  return { userId: uid, clinicianId: cid };
}

export async function unlinkUserFromClinician(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  const clinicianRow = await query(
    `SELECT id FROM app_records
      WHERE model = 'Clinician'
        AND (data->>'user' = $1 OR data->>'userId' = $1)
      LIMIT 1`,
    [uid]
  );

  if (clinicianRow.rows[0]?.id) {
    const cid = clinicianRow.rows[0].id;
    await query(
      `UPDATE app_records
          SET data = (COALESCE(data, '{}'::jsonb) - 'user' - 'userId') || $2::jsonb,
              updated_at = NOW()
        WHERE model = 'Clinician' AND id = $1`,
      [cid, JSON.stringify({ updatedAt: new Date().toISOString() })]
    );
  }

  await query(
    `UPDATE app_records
        SET data = (COALESCE(data, '{}'::jsonb) - 'clinicianId' - 'clinician_id') || $2::jsonb,
            updated_at = NOW()
      WHERE model = 'user' AND id = $1`,
    [uid, JSON.stringify({ updatedAt: new Date().toISOString() })]
  );

  return { userId: uid };
}
