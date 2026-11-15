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

// GET /alerts?crew_id=1
// Returns all active alerts, optionally filtered by crew member
router.get('/alerts', async (req: Request, res: Response) => {
  const crewIdParam = req.query['crew_id'];
  const crewId = crewIdParam ? parseInt(crewIdParam as string, 10) : null;

  try {
    const alerts = crewId
      ? await query(`
          SELECT a.*, c.name AS crew_name
          FROM alerts a
          JOIN crew c ON c.id = a.crew_id
          WHERE a.crew_id = $1 AND a.resolved_at IS NULL
          ORDER BY a.created_at DESC
        `, [crewId])
      : await query(`
          SELECT a.*, c.name AS crew_name
          FROM alerts a
          JOIN crew c ON c.id = a.crew_id
          WHERE a.resolved_at IS NULL
          ORDER BY a.created_at DESC
        `);

    res.json(alerts);
  } catch (err) {
    console.error('GET /alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
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
      const vitalsPayload: VitalsPayload = {
        heart_rate:       heart_rate        ?? 0,
        systolic_bp:      systolic_bp       ?? 0,
        diastolic_bp:     diastolic_bp      ?? 0,
        spo2:             spo2              ?? 0,
        body_temp:        body_temp         ?? 0,
        respiration_rate: respiration_rate  ?? 0,
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
