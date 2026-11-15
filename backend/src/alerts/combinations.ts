import { query } from '../db/pool';

// A combination fires when BOTH vitals have active alerts in the specified directions.
// 'any' in direction means either high or low triggers the combination.
interface ComboRule {
  id:         string;             // unique key — used as vital_name in the alert row
  vitals:     [string, string];   // the two vitals that must both be alerting
  directions: ['any' | 'high' | 'low', 'any' | 'high' | 'low'];
  message:    string;
  guidance:   { space: string; village: string };
  severity:   'low' | 'medium' | 'high';
}

const COMBINATIONS: ComboRule[] = [
  {
    id:         'spo2+heart_rate',
    vitals:     ['spo2', 'heart_rate'],
    directions: ['low', 'high'],
    message:    'Low blood oxygen combined with elevated heart rate — your heart is working harder to compensate for reduced oxygen. This combination may indicate respiratory or cardiovascular stress.',
    guidance: {
      space:   'Sit upright. Take slow deep breaths. Do not exert yourself. Remove any tight equipment around the chest. Re-check SpO2 and heart rate in 5 minutes. Alert mission control immediately — do not wait.',
      village: 'Sit upright. Take slow deep breaths. Do not exert yourself. Rest in a cool, ventilated area. Re-check in 5 minutes. Go to the nearest clinic immediately if readings do not improve.',
    },
    severity: 'high',
  },
  {
    id:         'systolic_bp+heart_rate',
    vitals:     ['systolic_bp', 'heart_rate'],
    directions: ['high', 'high'],
    message:    'High blood pressure and elevated heart rate together signal significant cardiovascular stress. Both readings above normal at the same time is more serious than either alone.',
    guidance: {
      space:   'Stop all activity immediately. Sit or lie down. Do not stand suddenly. Breathe slowly and deeply. Avoid any exertion — even walking. Contact mission control or the flight surgeon now.',
      village: 'Stop all activity. Sit or lie down in a comfortable position. Breathe slowly. Avoid any effort. Seek the nearest clinic or call emergency services now.',
    },
    severity: 'high',
  },
  {
    id:         'body_temp+heart_rate',
    vitals:     ['body_temp', 'heart_rate'],
    directions: ['high', 'high'],
    message:    'Elevated temperature combined with an elevated heart rate may indicate a developing infection or heat stress. The body is fighting something.',
    guidance: {
      space:   'Move to a cooler area. Remove excess clothing. Drink cool fluids. Take temperature every 30 minutes. If temperature exceeds 38.5°C, contact the flight surgeon. Do not ignore this combination.',
      village: 'Move to a cooler, shaded area. Drink cool fluids. Rest. Take temperature every 30 minutes. If temperature exceeds 38.5°C or you feel worse, seek the nearest clinic immediately.',
    },
    severity: 'medium',
  },
  {
    id:         'sleep_hours+mood',
    vitals:     ['sleep_hours', 'mood'],
    directions: ['low', 'low'],
    message:    'Sleep deprivation and low mood together significantly increase health risk and impair decision-making. This combination is a known risk factor for accidents and health decline during long missions.',
    guidance: {
      space:   'Rest is the immediate priority. Hand off any high-risk tasks to another crew member. Eat a meal and drink water. Alert mission control — combined sleep and mood decline is a mission health event that requires monitoring.',
      village: 'Rest as your first priority. Do not perform any complex or risky tasks. Eat a meal, drink water, and talk to someone you trust. If this continues for 2 or more days, seek help from a clinic or health worker.',
    },
    severity: 'medium',
  },
  {
    id:         'spo2+respiration_rate',
    vitals:     ['spo2', 'respiration_rate'],
    directions: ['low', 'high'],
    message:    'Your blood oxygen is falling while your breathing rate has increased — your body is breathing faster to try to bring oxygen levels up. This is an early warning sign of respiratory distress.',
    guidance: {
      space:   'Sit upright. Take slow, deliberate breaths — faster breathing is counterproductive. Check your suit or habitat air supply. Alert mission control now. This combination needs immediate evaluation.',
      village: 'Sit upright. Try to slow your breathing — count 4 in, hold 2, out 6. Do not lie flat. Move to fresh air. Go to the nearest clinic immediately.',
    },
    severity: 'high',
  },
];

interface ActiveAlertRow {
  vital_name: string;
  alert_type: string;
  severity: string;
  value: number;
}

export async function checkCombinations(crewId: number, environment = 'space'): Promise<void> {
  // Fetch all currently active alerts for this person (anomaly + trend only — not combination itself)
  const activeAlerts = await query<ActiveAlertRow>(
    `SELECT vital_name, alert_type, severity, value
     FROM alerts
     WHERE crew_id = $1
       AND alert_type IN ('anomaly', 'trend')
       AND resolved_at IS NULL`,
    [crewId]
  );

  // Build a quick lookup: vital_name → worst active severity
  const alertedVitals: Record<string, string> = {};
  const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };

  for (const a of activeAlerts) {
    const existing = alertedVitals[a.vital_name];
    if (!existing || severityRank[a.severity]! > severityRank[existing]!) {
      alertedVitals[a.vital_name] = a.severity;
    }
  }

  for (const rule of COMBINATIONS) {
    const [vA, vB]  = rule.vitals;
    const [dA, dB]  = rule.directions;

    // Check whether both vitals are currently alerting
    const aActive = alertedVitals[vA!] !== undefined;
    const bActive = alertedVitals[vB!] !== undefined;
    const bothActive = aActive && bActive;

    if (!bothActive) {
      // Combination resolved — close any open combination alert for this rule
      await query(
        `UPDATE alerts SET resolved_at = NOW()
         WHERE crew_id = $1 AND vital_name = $2 AND alert_type = 'combination' AND resolved_at IS NULL`,
        [crewId, rule.id]
      );
      continue;
    }

    // Both are alerting — check if there's already an active combination alert
    const existing = await query<{ id: number }>(
      `SELECT id FROM alerts
       WHERE crew_id = $1 AND vital_name = $2 AND alert_type = 'combination' AND resolved_at IS NULL
       LIMIT 1`,
      [crewId, rule.id]
    );

    const guidance = rule.guidance[environment as 'space' | 'village'] ?? rule.guidance.space;

    if (existing.length > 0) {
      // Update severity in case it changed
      await query(
        `UPDATE alerts SET severity = $1 WHERE id = $2`,
        [rule.severity, existing[0]!.id]
      );
    } else {
      await query(
        `INSERT INTO alerts (crew_id, vital_name, alert_type, severity, message, guidance, value)
         VALUES ($1, $2, 'combination', $3, $4, $5, 0)`,
        [crewId, rule.id, rule.severity, rule.message, guidance]
      );
      console.log(`[Combination] crew=${crewId} combo=${rule.id} severity=${rule.severity}`);
    }
  }
}
