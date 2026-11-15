import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

const router = Router();

// GET /alerts?crew_id=1
// Returns all active alerts, optionally filtered by crew member
router.get('/', async (req: Request, res: Response) => {
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

export default router;
