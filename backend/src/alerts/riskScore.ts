import { query } from '../db/pool';

// Weight per alert severity — how much each contributes to the 0-100 risk score
const SEVERITY_WEIGHTS = {
  low:    10,
  medium: 25,
  high:   50,
};

// Additional weight for trend alerts — a trend means the problem is ongoing, not a one-time spike
const TREND_BONUS = 5;

export interface RiskResult {
  score:       number;             // 0–100
  level:       'green' | 'yellow' | 'red';
  alert_count: number;             // total active alerts
  breakdown: {
    low:    number;
    medium: number;
    high:   number;
  };
}

interface AlertRow {
  severity:   string;
  alert_type: string;
}

export async function calculateRiskScore(crewId: number): Promise<RiskResult> {
  // Fetch all active alerts for this crew member
  const alerts = await query<AlertRow>(
    `SELECT severity, alert_type
     FROM alerts
     WHERE crew_id = $1 AND resolved_at IS NULL`,
    [crewId]
  );

  let score = 0;
  let lowCount    = 0;
  let mediumCount = 0;
  let highCount   = 0;

  for (const alert of alerts) {
    const weight = SEVERITY_WEIGHTS[alert.severity as keyof typeof SEVERITY_WEIGHTS] ?? 0;
    const bonus  = alert.alert_type === 'trend' ? TREND_BONUS : 0;
    score += weight + bonus;

    if      (alert.severity === 'low')    lowCount++;
    else if (alert.severity === 'medium') mediumCount++;
    else if (alert.severity === 'high')   highCount++;
  }

  // Cap at 100 — multiple simultaneous alerts can't push score above 100
  score = Math.min(score, 100);

  // Determine colour level for the dashboard
  let level: 'green' | 'yellow' | 'red';
  if      (score >= 60) level = 'red';
  else if (score >= 30) level = 'yellow';
  else                  level = 'green';

  return {
    score,
    level,
    alert_count: alerts.length,
    breakdown: {
      low:    lowCount,
      medium: mediumCount,
      high:   highCount,
    },
  };
}

// Writes the latest risk score to the crew table for fast dashboard reads
// Called after every pipeline run so the score is always up to date
export async function updateRiskScore(crewId: number): Promise<RiskResult> {
  const result = await calculateRiskScore(crewId);

  // Store score + level on the crew row so GET /crew can return it without re-calculating
  await query(
    `UPDATE crew SET risk_score = $1, risk_level = $2 WHERE id = $3`,
    [result.score, result.level, crewId]
  );

  return result;
}
