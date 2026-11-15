import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { processReading } from '../alerts/pipeline';
import { VitalsPayload } from '../simulator/simulator';

const router = Router();

// GET /crew/:id/vitals?limit=50
// Returns recent readings for one crew member — used by charts
router.get('/:id/vitals', async (req: Request, res: Response) => {
  const crewId = parseInt(req.params.id ?? '', 10);
  const limit  = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 500);

  if (isNaN(crewId)) {
    res.status(400).json({ error: 'Invalid crew id' });
    return;
  }

  try {
    const readings = await query(`
      SELECT id, heart_rate, systolic_bp, diastolic_bp, spo2,
             body_temp, respiration_rate, radiation_dose,
             sleep_hours, mood, source, recorded_at
      FROM vitals_readings
      WHERE crew_id = $1
      ORDER BY recorded_at DESC
      LIMIT $2
    `, [crewId, limit]);

    // Reverse so oldest is first — charts render left-to-right in time order
    res.json((readings as unknown[]).reverse());
  } catch (err) {
    console.error(`GET /crew/${crewId}/vitals error:`, err);
    res.status(500).json({ error: 'Failed to fetch vitals' });
  }
});

// POST /crew/:id/readings
// Astronaut or village user manually logs a reading
// Body (all fields optional — user may only have some readings available):
// { heart_rate, systolic_bp, diastolic_bp, spo2, body_temp,
//   respiration_rate, sleep_hours, mood }
router.post('/:id/readings', async (req: Request, res: Response) => {
  const crewId = parseInt(req.params.id ?? '', 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: 'Invalid crew id' });
    return;
  }

  // Verify crew member exists
  const crewRows = await query('SELECT id FROM crew WHERE id = $1', [crewId]);
  if (crewRows.length === 0) {
    res.status(404).json({ error: 'Crew member not found' });
    return;
  }

  const {
    heart_rate,
    systolic_bp,
    diastolic_bp,
    spo2,
    body_temp,
    respiration_rate,
    sleep_hours,
    mood,
  } = req.body as Partial<VitalsPayload & { sleep_hours: number; mood: number }>;

  // Validate mood range if provided
  if (mood !== undefined && mood !== null && (mood < 1 || mood > 5)) {
    res.status(400).json({ error: 'Mood must be between 1 and 5' });
    return;
  }

  try {
    const rows = await query<{ id: number }>(`
      INSERT INTO vitals_readings
        (crew_id, heart_rate, systolic_bp, diastolic_bp, spo2,
         body_temp, respiration_rate, sleep_hours, mood, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
      RETURNING id
    `, [
      crewId,
      heart_rate        ?? null,
      systolic_bp       ?? null,
      diastolic_bp      ?? null,
      spo2              ?? null,
      body_temp         ?? null,
      respiration_rate  ?? null,
      sleep_hours       ?? null,
      mood              ?? null,
    ]);

    const readingId = rows[0]?.id;
    if (readingId !== undefined) {
      // Pass null for fields not submitted — anomaly detector skips nulls.
      // Using ?? null (not ?? 0) so a missing field never triggers a false zero-value alert.
      const vitalsPayload: VitalsPayload = {
        heart_rate:       heart_rate        ?? null,
        systolic_bp:      systolic_bp       ?? null,
        diastolic_bp:     diastolic_bp      ?? null,
        spo2:             spo2              ?? null,
        body_temp:        body_temp         ?? null,
        respiration_rate: respiration_rate  ?? null,
        radiation_dose:   null,
        sleep_hours:      sleep_hours       ?? null,
        mood:             mood              ?? null,
      };
      await processReading(crewId, readingId, vitalsPayload);
    }

    res.status(201).json({ id: readingId, message: 'Reading recorded' });
  } catch (err) {
    console.error(`POST /crew/${crewId}/readings error:`, err);
    res.status(500).json({ error: 'Failed to save reading' });
  }
});

export default router;
