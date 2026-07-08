const fs = require('fs');
const file = 'd:\\hp Laptop Data\\cps-intranet\\cps-intranet\\cps-intranet\\backend\\controllers\\rotaController.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. In createBulkShifts, it inserts into rota_shifts. Let's find it.
const bulkRegex = /INSERT INTO rota_shifts \(\s*id,\s*clinician_id,\s*surgery_id,\s*shift_date,\s*shift_type,\s*start_time,\s*end_time,\s*expected_hours,\s*is_cover,\s*is_filled,\s*rota_month,\s*rota_year,\s*created_by,\s*created_at,\s*updated_at\s*\)\s*VALUES \(\s*\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, NOW\(\), NOW\(\)\s*\)/g;

const newBulkInsert = `INSERT INTO rota_shifts (
               id,
               clinician_id,
               surgery_id,
               shift_date,
               shift_type,
               start_time,
               end_time,
               expected_hours,
               is_cover,
               is_filled,
               rota_month,
               rota_year,
               created_by,
               hourly_rate,
               clinical_system,
               created_at,
               updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
             )`;

let modified = false;

// We also need to update the query params array to pass $14 (hourly_rate) and $15 (clinical_system).
// Let's replace the query manually using string methods.

const bulkBlock = `await query(
            \`INSERT INTO rota_shifts (
               id,
               clinician_id,
               surgery_id,
               shift_date,
               shift_type,
               start_time,
               end_time,
               expected_hours,
               is_cover,
               is_filled,
               rota_month,
               rota_year,
               created_by,
               created_at,
               updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
             )\`,
            [
              id,
              finalClinicianId,
              practice_id,
              dateStr,
              mappedType,
              shift_start || null,
              shift_end || null,
              total_hours,
              !!finalIsCover,
              !!finalClinicianId,
              m,
              y,
              req.user?.id || null,
            ]
          );`;

const newBulkBlock = `await query(
            \`INSERT INTO rota_shifts (
               id, clinician_id, surgery_id, shift_date, shift_type,
               start_time, end_time, expected_hours, is_cover, is_filled,
               rota_month, rota_year, created_by, hourly_rate, clinical_system, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
             )\`,
            [
              id,
              finalClinicianId,
              practice_id,
              dateStr,
              mappedType,
              shift_start || null,
              shift_end || null,
              total_hours,
              !!finalIsCover,
              !!finalClinicianId,
              m,
              y,
              req.user?.id || null,
              rate,
              clinical_system || null
            ]
          );`;

if (content.includes(bulkBlock)) {
  content = content.replace(bulkBlock, newBulkBlock);
  modified = true;
  console.log("Updated createBulkShifts");
}

// Update mirrorShiftToRotaShifts block 1
const mirrorBlock1 = `try {
      await query(
        \`INSERT INTO rota_shifts (
           id, clinician_id, surgery_id, shift_date, shift_type,
           start_time, end_time, expected_hours, is_cover, is_filled,
           rota_month, rota_year, created_by, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           clinician_id = EXCLUDED.clinician_id,
           surgery_id = EXCLUDED.surgery_id,
           shift_date = EXCLUDED.shift_date,
           shift_type = EXCLUDED.shift_type,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           expected_hours = EXCLUDED.expected_hours,
           is_cover = EXCLUDED.is_cover,
           is_filled = EXCLUDED.is_filled,
           rota_month = EXCLUDED.rota_month,
           rota_year = EXCLUDED.rota_year,
           updated_at = NOW()\`,
        [
          shift.id,
          clinicianId,
          shift.practice_id,
          dateStr,
          mappedType,
          shift.start_time || null,
          shift.end_time || null,
          hours,
          !!shift.is_cover || shiftType === "cover",
          shiftType === "working" && !!clinicianId,
          m,
          y,
          shift.created_by || null,
        ]
      );
    } catch (err: any) {`;

const newMirrorBlock1 = `const hourlyRate = shift.hourly_rate ?? null;
    const clinicalSystem = shift.clinical_system ?? null;

    try {
      await query(
        \`INSERT INTO rota_shifts (
           id, clinician_id, surgery_id, shift_date, shift_type,
           start_time, end_time, expected_hours, is_cover, is_filled,
           rota_month, rota_year, created_by, hourly_rate, clinical_system, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           clinician_id = EXCLUDED.clinician_id,
           surgery_id = EXCLUDED.surgery_id,
           shift_date = EXCLUDED.shift_date,
           shift_type = EXCLUDED.shift_type,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           expected_hours = EXCLUDED.expected_hours,
           is_cover = EXCLUDED.is_cover,
           is_filled = EXCLUDED.is_filled,
           rota_month = EXCLUDED.rota_month,
           rota_year = EXCLUDED.rota_year,
           hourly_rate = EXCLUDED.hourly_rate,
           clinical_system = EXCLUDED.clinical_system,
           updated_at = NOW()\`,
        [
          shift.id,
          clinicianId,
          shift.practice_id,
          dateStr,
          mappedType,
          shift.start_time || null,
          shift.end_time || null,
          hours,
          !!shift.is_cover || shiftType === "cover",
          shiftType === "working" && !!clinicianId,
          m,
          y,
          shift.created_by || null,
          hourlyRate,
          clinicalSystem
        ]
      );
    } catch (err: any) {`;

if (content.includes(mirrorBlock1)) {
  content = content.replace(mirrorBlock1, newMirrorBlock1);
  modified = true;
  console.log("Updated mirrorShiftToRotaShifts block 1");
}

// Update mirrorShiftToRotaShifts fallback block 2
const mirrorBlock2 = `await query(
        \`INSERT INTO rota_shifts (
           id, clinician_id, surgery_id, shift_date, shift_type,
           start_time, end_time, expected_hours, is_cover, is_filled,
           rota_month, rota_year, created_by, created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM rota_shifts WHERE id = $1)\`,
        [
          shift.id,
          clinicianId,
          shift.practice_id,
          dateStr,
          mappedType,
          shift.start_time || null,
          shift.end_time || null,
          hours,
          !!shift.is_cover || shiftType === "cover",
          shiftType === "working" && !!clinicianId,
          m,
          y,
          shift.created_by || null,
        ]
      );`;

const newMirrorBlock2 = `await query(
        \`INSERT INTO rota_shifts (
           id, clinician_id, surgery_id, shift_date, shift_type,
           start_time, end_time, expected_hours, is_cover, is_filled,
           rota_month, rota_year, created_by, hourly_rate, clinical_system, created_at, updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM rota_shifts WHERE id = $1)\`,
        [
          shift.id,
          clinicianId,
          shift.practice_id,
          dateStr,
          mappedType,
          shift.start_time || null,
          shift.end_time || null,
          hours,
          !!shift.is_cover || shiftType === "cover",
          shiftType === "working" && !!clinicianId,
          m,
          y,
          shift.created_by || null,
          hourlyRate,
          clinicalSystem
        ]
      );`;

if (content.includes(mirrorBlock2)) {
  content = content.replace(mirrorBlock2, newMirrorBlock2);
  modified = true;
  console.log("Updated mirrorShiftToRotaShifts block 2");
}

if (modified) {
  fs.writeFileSync(file, content);
  console.log("rotaController.ts modified successfully.");
} else {
  console.log("No blocks matched for replacement.");
}
