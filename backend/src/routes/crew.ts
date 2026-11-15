import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

const router = Router();

// GET /crew
// Returns all crew members with their latest vital reading and active alert count
router.get('/', async (_req: Request, res: Response) => {
  try {
    const crew = await query<{
      id: number;
      name: string;
      age: number;
      role: string;
      environment: string;
      mission: string;
      alert_count: string;
    }>(`
      SELECT
        c.id, c.name, c.age, c.role, c.environment, c.mission,
        COUNT(a.id) AS alert_count
      FROM crew c
      LEFT JOIN alerts a ON a.crew_id = c.id AND a.resolved_at IS NULL
      GROUP BY c.id
      ORDER BY c.id
    `);

    res.json(crew);
  } catch (err) {
    console.error('GET /crew error:', err);
    res.status(500).json({ error: 'Failed to fetch crew' });
  }
});

// GET /crew/:id
// Returns one crew member's profile + latest vitals + risk score
router.get('/:id', async (req: Request, res: Response) => {
  const crewId = parseInt(req.params.id ?? '', 10);
  if (isNaN(crewId)) {
    res.status(400).json({ error: 'Invalid crew id' });
    return;
  }

  try {
    // Profile
    const crewRows = await query<{
      id: number;
      name: string;
      age: number;
      role: string;
      environment: string;
      mission: string;
    }>('SELECT * FROM crew WHERE id = $1', [crewId]);

    if (crewRows.length === 0) {
      res.status(404).json({ error: 'Crew member not found' });
      return;
    }

    // Latest reading
    const latestRows = await query<{
      heart_rate: number;
      systolic_bp: number;
      diastolic_bp: number;
      spo2: number;
      body_temp: number;
      respiration_rate: number;
      radiation_dose: number;
      sleep_hours: number;
      mood: number;
      recorded_at: string;
    }>(`
      SELECT heart_rate, systolic_bp, diastolic_bp, spo2,
             body_temp, respiration_rate, radiation_dose,
             sleep_hours, mood, recorded_at
      FROM vitals_readings
      WHERE crew_id = $1
      ORDER BY recorded_at DESC
      LIMIT 1
    `, [crewId]);

    // Risk score from active alerts
    const riskRows = await query<{ risk_score: number }>(`
      SELECT LEAST(
        COALESCE(SUM(
          CASE severity
            WHEN 'low'    THEN 10
            WHEN 'medium' THEN 25
            WHEN 'high'   THEN 50
            ELSE 0
          END
        ), 0), 100
      ) AS risk_score
      FROM alerts
      WHERE crew_id = $1 AND resolved_at IS NULL
    `, [crewId]);

    // Active alerts
    const alerts = await query<{
      id: number;
      vital_name: string;
      alert_type: string;
      severity: string;
      message: string;
      guidance: string;
      value: number;
      created_at: string;
    }>(`
      SELECT id, vital_name, alert_type, severity, message, guidance, value, created_at
      FROM alerts
      WHERE crew_id = $1 AND resolved_at IS NULL
      ORDER BY created_at DESC
    `, [crewId]);

    res.json({
      ...crewRows[0],
      latest_vitals: latestRows[0] ?? null,
      risk_score: riskRows[0]?.risk_score ?? 0,
      active_alerts: alerts,
    });
  } catch (err) {
    console.error(`GET /crew/${crewId} error:`, err);
    res.status(500).json({ error: 'Failed to fetch crew member' });
  }
});

export default router;
