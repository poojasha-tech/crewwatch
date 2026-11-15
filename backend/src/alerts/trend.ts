import { query } from '../db/pool';
import { VitalsPayload } from '../simulator/simulator';

// How many consecutive readings to analyse for a trend
const WINDOW = 20;

// Minimum slope (change per reading) to trigger a trend alert
// Different vitals have different scales so thresholds differ
const SLOPE_THRESHOLDS: Partial<Record<keyof VitalsPayload, { low: number; medium: number; high: number }>> = {
  heart_rate:       { low: 0.3, medium: 0.6, high: 1.0 },  // bpm per reading
  systolic_bp:      { low: 0.3, medium: 0.6, high: 1.0 },  // mmHg per reading
  diastolic_bp:     { low: 0.2, medium: 0.4, high: 0.7 },
  spo2:             { low: 0.1, medium: 0.2, high: 0.35 }, // % per reading — spo2 moves slowly
  body_temp:        { low: 0.02, medium: 0.04, high: 0.07 }, // °C per reading — temp moves very slowly
  respiration_rate: { low: 0.2, medium: 0.4, high: 0.7 },
  radiation_dose:   { low: 0.005, medium: 0.01, high: 0.02 },
};

const TREND_MESSAGES: Partial<Record<keyof VitalsPayload, { rising: string; falling: string }>> = {
  heart_rate: {
    rising:  'Your heart rate has been steadily increasing over the last several readings.',
    falling: 'Your heart rate has been steadily decreasing over the last several readings.',
  },
  systolic_bp: {
    rising:  'Your blood pressure (upper number) has been steadily rising — this may indicate early hypertension or dehydration.',
    falling: 'Your blood pressure (upper number) has been steadily falling — this may indicate dehydration or low blood volume.',
  },
  diastolic_bp: {
    rising:  'Your blood pressure (lower number) has been steadily rising.',
    falling: 'Your blood pressure (lower number) has been steadily falling.',
  },
  spo2: {
    rising:  'Your blood oxygen level has been slowly improving — this is a positive sign.',
    falling: 'Your blood oxygen level has been slowly declining. Even small drops over time are significant.',
  },
  body_temp: {
    rising:  'Your body temperature has been slowly rising — early signs of a developing fever.',
    falling: 'Your body temperature has been slowly falling — monitor for hypothermia.',
  },
  respiration_rate: {
    rising:  'Your breathing rate has been gradually increasing over the last several readings.',
    falling: 'Your breathing rate has been gradually slowing over the last several readings.',
  },
  radiation_dose: {
    rising:  'Your radiation exposure has been steadily increasing — check your shielding.',
    falling: 'Your radiation exposure has been decreasing — this is a positive sign.',
  },
};

const TREND_GUIDANCE: Partial<Record<keyof VitalsPayload, { rising: string; falling: string }>> = {
  heart_rate: {
    rising:  'Rest and avoid any physical exertion. Take slow deep breaths. Drink water. Re-check in 10 minutes. If the trend continues or you feel symptoms, contact medical support.',
    falling: 'Lie down and rest. Avoid sudden movements. Stay warm. Re-check in 10 minutes. Contact medical support if you feel faint or confused.',
  },
  systolic_bp: {
    rising:  'Rest quietly. Drink water. Avoid exertion and salt. Re-check in 15 minutes. If the upward trend continues over multiple re-checks, contact medical support.',
    falling: 'Lie down. Drink water. Move slowly when getting up. Re-check in 10 minutes. Contact medical support if you feel faint.',
  },
  diastolic_bp: {
    rising:  'Rest and hydrate. Re-check in 15 minutes. Contact medical support if trend continues.',
    falling: 'Rest and hydrate. Avoid sudden movements. Re-check in 10 minutes.',
  },
  spo2: {
    rising:  'No action needed. Continue monitoring.',
    falling: 'Sit upright. Take slow deep breaths. Move to better ventilation if possible. Re-check in 5 minutes. If decline continues below 94%, contact medical support immediately.',
  },
  body_temp: {
    rising:  'Remove excess clothing. Move to a cooler area. Drink cool water. Re-check in 15 minutes. If temperature reaches 38.5°C, contact medical support.',
    falling: 'Add warm layers. Move to a warmer area. Drink warm fluids. Re-check in 15 minutes. If temperature drops below 36°C, contact medical support.',
  },
  respiration_rate: {
    rising:  'Practice slow breathing: 4 counts in, 2 hold, 6 out. Rest. Re-check in 5 minutes. Contact medical support if the increase continues.',
    falling: 'Take several deep breaths. Sit upright. Rest. Re-check in 5 minutes. Contact medical support if you feel drowsy.',
  },
  radiation_dose: {
    rising:  'Move to a more shielded area. Check suit/equipment integrity. Log the exposure and report to mission control.',
    falling: 'No action needed. Continue monitoring.',
  },
};

interface ReadingRow {
  value: number;
  idx: number;
}

// Linear regression slope — measures the direction and rate of change
// Returns positive slope if values are rising, negative if falling
// Uses least-squares line fitting: slope = Σ(x - x̄)(y - ȳ) / Σ(x - x̄)²
function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const xMean = (n - 1) / 2; // x values are 0,1,2,...,n-1 so mean = (n-1)/2
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let numerator   = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = values[i]! - yMean;
    numerator   += dx * dy;
    denominator += dx * dx;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

export async function checkTrend(
  crewId: number,
  vitals: VitalsPayload
): Promise<void> {
  const vitalsToCheck = Object.keys(SLOPE_THRESHOLDS) as (keyof VitalsPayload)[];

  for (const vitalName of vitalsToCheck) {
    const currentValue = vitals[vitalName];
    if (currentValue === null || currentValue === undefined) continue;

    // Fetch last WINDOW readings for this vital, oldest first
    const rows = await query<ReadingRow>(
      `SELECT ${vitalName} AS value,
              ROW_NUMBER() OVER (ORDER BY recorded_at ASC) AS idx
       FROM vitals_readings
       WHERE crew_id = $1
         AND ${vitalName} IS NOT NULL
       ORDER BY recorded_at DESC
       LIMIT $2`,
      [crewId, WINDOW]
    );

    // Not enough data yet to detect a trend
    if (rows.length < WINDOW) continue;

    // Extract values in chronological order (oldest → newest)
    const values = rows.map(r => Number(r.value)).reverse();
    const slope  = linearSlope(values);
    const absSlope = Math.abs(slope);
    const thresholds = SLOPE_THRESHOLDS[vitalName]!;

    // Determine severity based on how steep the slope is
    let severity: 'low' | 'medium' | 'high' | null = null;
    if      (absSlope >= thresholds.high)   severity = 'high';
    else if (absSlope >= thresholds.medium) severity = 'medium';
    else if (absSlope >= thresholds.low)    severity = 'low';

    if (!severity) {
      // Trend resolved — vital is stable again
      await query(
        `UPDATE alerts SET resolved_at = NOW()
         WHERE crew_id = $1 AND vital_name = $2
           AND alert_type = 'trend' AND resolved_at IS NULL`,
        [crewId, vitalName]
      );
      continue;
    }

    const direction = slope > 0 ? 'rising' : 'falling';
    const messages  = TREND_MESSAGES[vitalName];
    const guidances = TREND_GUIDANCE[vitalName];

    const message  = messages?.[direction]  ?? `${vitalName} is trending ${direction}.`;
    const guidance = guidances?.[direction] ?? 'Monitor closely and contact medical support if the trend continues.';

    // Deduplication — same logic as anomaly detector
    const existing = await query<{ id: number }>(
      `SELECT id FROM alerts
       WHERE crew_id = $1 AND vital_name = $2
         AND alert_type = 'trend' AND resolved_at IS NULL
       LIMIT 1`,
      [crewId, vitalName]
    );

    if (existing.length > 0) {
      await query(
        `UPDATE alerts SET severity = $1, value = $2
         WHERE id = $3`,
        [severity, currentValue, existing[0]!.id]
      );
    } else {
      await query(
        `INSERT INTO alerts
          (crew_id, vital_name, alert_type, severity, message, guidance, value)
         VALUES ($1, $2, 'trend', $3, $4, $5, $6)`,
        [crewId, vitalName, severity, message, guidance, currentValue]
      );

      console.log(`[Trend] crew=${crewId} vital=${vitalName} slope=${slope.toFixed(3)} direction=${direction} severity=${severity}`);
    }
  }
}
