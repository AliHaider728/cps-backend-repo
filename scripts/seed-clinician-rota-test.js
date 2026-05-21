/**
 * Seeds test clinicians, linked users, and multi-month rota shifts.
 * Run: node scripts/seed-clinician-rota-test.js
 */
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { initDB, query } from "../config/db.js";
import { linkUserToClinician } from "../lib/clinicianLink.js";

dotenv.config();

const PASSWORD = "TestClinician1!";
const PASSWORD_ROUNDS = 12;

async function upsertAppRecord(model, id, data) {
  await query(
    `INSERT INTO app_records (model, id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (model, id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [model, id, JSON.stringify({ ...data, updatedAt: new Date().toISOString() })]
  );
}

async function insertShift({ clinicianId, practiceId, date, status = "working" }) {
  const id = uuidv4();
  const hours = 8;
  await query(
    `INSERT INTO shifts (
       id, clinician_id, practice_id, date, start_time, end_time, hours, status, is_cover, source, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, '09:00', '17:00', $5, $6, false, 'seed', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, clinicianId, practiceId, date, hours, status]
  );

  const [y, m] = date.split("-").map(Number);
  const shiftType = status === "cppe" ? "cppe_training" : status;
  await query(
    `INSERT INTO rota_shifts (
       id, clinician_id, surgery_id, shift_date, shift_type,
       start_time, end_time, expected_hours, is_cover, is_filled,
       rota_month, rota_year, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, '09:00', '17:00', $6, false, true, $7, $8, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       clinician_id = EXCLUDED.clinician_id,
       shift_date = EXCLUDED.shift_date,
       updated_at = NOW()`,
    [id, clinicianId, practiceId, date, shiftType, hours, m, y]
  );
  return id;
}

function weekdaysInMonth(year, month) {
  const dates = [];
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCMonth() === month - 1) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

async function backfillShiftsToRota() {
  const rows = await query(
    `SELECT * FROM shifts WHERE COALESCE(clinician_id::text, '') <> '' AND status <> 'cancelled'`
  );
  let n = 0;
  for (const row of rows.rows) {
    const shift = {
      id: row.id,
      clinician_id: row.clinician_id,
      practice_id: row.practice_id,
      date: row.date?.toISOString?.().slice(0, 10) || row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      hours: row.hours,
      status: row.status,
      is_cover: row.is_cover,
      created_by: row.created_by,
    };
    const [y, m] = String(shift.date).slice(0, 10).split("-").map(Number);
    const shiftType = shift.status === "cppe" ? "cppe_training" : shift.status;
    await query(
      `INSERT INTO rota_shifts (
         id, clinician_id, surgery_id, shift_date, shift_type,
         start_time, end_time, expected_hours, is_cover, is_filled,
         rota_month, rota_year, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [
        shift.id,
        shift.clinician_id,
        shift.practice_id,
        shift.date,
        shiftType,
        shift.start_time,
        shift.end_time,
        shift.hours,
        !!shift.is_cover,
        m,
        y,
      ]
    );
    n += 1;
  }
  console.log(`Backfilled ${n} shifts → rota_shifts`);
}

async function main() {
  await initDB();
  await backfillShiftsToRota();

  const practiceRow = await query(
    `SELECT id, data FROM app_records WHERE model = 'practice' ORDER BY created_at LIMIT 1`
  );
  const practiceId = practiceRow.rows[0]?.id;
  if (!practiceId) {
    console.error("No practice in app_records. Run node seed.js first.");
    process.exit(1);
  }
  const practiceName = practiceRow.rows[0]?.data?.name || "Test Practice";
  console.log(`Using practice: ${practiceName} (${practiceId})`);

  const fixtures = [
    {
      clinicianId: uuidv4(),
      userId: uuidv4(),
      fullName: "Test Clinician Alpha",
      email: "clinician.alpha@test.cps.local",
    },
    {
      clinicianId: uuidv4(),
      userId: uuidv4(),
      fullName: "Test Clinician Beta",
      email: "clinician.beta@test.cps.local",
    },
  ];

  const hashed = await bcrypt.hash(PASSWORD, PASSWORD_ROUNDS);
  const now = new Date();
  const months = [
    { year: now.getFullYear(), month: now.getMonth() + 1 },
    { year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), month: now.getMonth() === 0 ? 12 : now.getMonth() },
    { year: now.getMonth() >= 11 ? now.getFullYear() + 1 : now.getFullYear(), month: now.getMonth() >= 11 ? 1 : now.getMonth() + 2 },
  ];

  for (const fx of fixtures) {
    await upsertAppRecord("Clinician", fx.clinicianId, {
      fullName: fx.fullName,
      email: fx.email,
      clinicianType: "Pharmacist",
      contractType: "ARRS",
      isActive: true,
      user: fx.userId,
      userId: fx.userId,
    });

    await upsertAppRecord("user", fx.userId, {
      name: fx.fullName,
      email: fx.email,
      password: hashed,
      role: "clinician",
      isActive: true,
      mustChangePassword: false,
      clinicianId: fx.clinicianId,
    });

    await linkUserToClinician(fx.userId, fx.clinicianId);

    let shiftCount = 0;
    for (const { year, month } of months) {
      const dates = weekdaysInMonth(year, month).slice(0, 6);
      for (const date of dates) {
        await insertShift({
          clinicianId: fx.clinicianId,
          practiceId,
          date,
          status: "working",
        });
        shiftCount += 1;
      }
    }

    console.log(`✓ ${fx.fullName}`);
    console.log(`  email: ${fx.email}  password: ${PASSWORD}`);
    console.log(`  clinicianId: ${fx.clinicianId}`);
    console.log(`  shifts seeded: ${shiftCount} (across ${months.length} months)`);
  }

  console.log("\nDone. Log in as a test clinician and open My Timesheet (All time view).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
