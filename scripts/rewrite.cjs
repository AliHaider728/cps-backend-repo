const fs = require('fs');

const file = 'd:\\hp Laptop Data\\cps-intranet\\cps-intranet\\cps-intranet\\backend\\controllers\\rotaController.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /async function mirrorShiftToRotaShifts\(shift: any\) \{[\s\S]*?\}(?=\s*export const|\s*\/\*\*)/;

const newCode = `async function mirrorShiftToRotaShifts(shift: any) {
  if (!shift?.date || !shift?.practice_id) return;
  const clinicianId = shift.clinician_id || null;
  const dateStr = String(shift.date).slice(0, 10);
  const [y, m] = dateStr.split("-").map(Number);
  const shiftType = String(shift.status || "working").toLowerCase();
  const mappedType = shiftType === "cppe" ? "cppe_training" : shiftType;
  const hours = shift.hours ?? computeHours(shift.start_time, shift.end_time);
  const hourlyRate = shift.hourly_rate ?? null;
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
  } catch (err: any) {
    console.warn(\`[MIRROR SHIFT] Error mirroring shift \${shift.id}:\`, err.message);
  }
}
`;

content = content.replace(regex, newCode);
fs.writeFileSync(file, content);
console.log("Done.");
