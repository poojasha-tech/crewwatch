import { query } from '../db/pool';
import { getBaseline } from './baseline';
import { VitalsPayload } from '../simulator/simulator';

// How many stddevs from baseline triggers each severity level
const Z_THRESHOLDS = {
  low:    2.5,  // unusual — 1.2% chance by random variation alone
  medium: 3.0,  // very unusual — 0.27% chance
  high:   3.5,  // extremely unusual — 0.05% chance
};

// Plain English messages per vital per direction (high or low)
// These go directly into the alerts table — no medical jargon
const MESSAGES: Record<string, { high: string; low: string }> = {
  heart_rate: {
    high: 'Your heart rate is significantly higher than your personal normal.',
    low:  'Your heart rate is significantly lower than your personal normal.',
  },
  systolic_bp: {
    high: 'Your blood pressure (upper number) is significantly higher than your personal normal.',
    low:  'Your blood pressure (upper number) is significantly lower than your personal normal.',
  },
  diastolic_bp: {
    high: 'Your blood pressure (lower number) is significantly higher than your personal normal.',
    low:  'Your blood pressure (lower number) is significantly lower than your personal normal.',
  },
  spo2: {
    high: 'Your blood oxygen level is unusually high — this is rarely a concern.',
    low:  'Your blood oxygen level has dropped below your personal normal.',
  },
  body_temp: {
    high: 'Your body temperature is significantly above your personal normal — possible fever.',
    low:  'Your body temperature is significantly below your personal normal — possible hypothermia.',
  },
  respiration_rate: {
    high: 'Your breathing rate is significantly faster than your personal normal.',
    low:  'Your breathing rate is significantly slower than your personal normal.',
  },
  radiation_dose: {
    high: 'Your radiation exposure today is significantly above your personal normal.',
    low:  'Your radiation exposure today is significantly below your personal normal.',
  },
  sleep_hours: {
    high: 'You have slept significantly more than your personal normal. Excessive sleep can indicate illness, fatigue recovery, or low energy.',
    low:  'You have slept significantly less than your personal normal. Sleep deprivation impairs judgement, coordination, reaction time, and immune function.',
  },
  mood: {
    high: 'Your reported mood is higher than your personal normal — generally a positive sign.',
    low:  'Your reported mood is significantly lower than your personal normal. This may reflect stress, fatigue, isolation, or the early onset of a health issue.',
  },
};

// First aid guidance per vital per direction
// Step by step — written so a non-medical person can follow immediately
const GUIDANCE: Record<string, { high: string; low: string }> = {
  heart_rate: {
    high: 'Sit down and rest immediately. Take slow, deep breaths — inhale for 4 seconds, hold for 4, exhale for 4. Avoid caffeine and physical activity. Re-check in 10 minutes. If rate stays above your normal or you feel chest pain or dizziness, contact medical support.',
    low:  'Lie down and rest. Avoid sudden movements — stand up slowly to prevent fainting. Stay warm. Re-check in 10 minutes. If you feel faint, confused, or short of breath, contact medical support immediately.',
  },
  systolic_bp: {
    high: 'Sit quietly and rest for 5 minutes. Do not exert yourself. Drink a glass of water if available. Avoid salt. Re-check in 15 minutes. If BP stays elevated or you experience headache, vision changes, or chest pain, contact medical support.',
    low:  'Lie down and elevate your legs slightly to help blood return to the heart. Drink water if available. Move slowly when getting up. Re-check in 10 minutes. If you feel faint or confused, contact medical support.',
  },
  diastolic_bp: {
    high: 'Rest quietly. Avoid any physical exertion. Drink water. Re-check in 15 minutes. If still elevated or you have symptoms, contact medical support.',
    low:  'Rest and hydrate. Avoid sudden position changes. Re-check in 10 minutes. Contact medical support if symptoms develop.',
  },
  spo2: {
    high: 'No action needed — high SpO2 is not harmful. Continue monitoring.',
    low:  'Sit upright — do not lie flat. Take 5 slow, deep breaths through your nose. Move to an area with better air circulation if possible. Re-check in 5 minutes. If SpO2 drops below 90% or you feel confused or cannot speak clearly, this is an emergency — contact medical support immediately.',
  },
  body_temp: {
    high: 'Remove excess clothing or blankets. Move to a cooler area if possible. Drink cool water. Place a damp cloth on forehead and neck. Re-check in 15 minutes. If temperature exceeds 39°C or you have severe symptoms, contact medical support.',
    low:  'Add warm clothing or blankets. Move to a warmer area. Drink warm fluids if available. Avoid alcohol. Re-check in 15 minutes. If temperature drops below 35°C or you feel confused or stop shivering, contact medical support immediately.',
  },
  respiration_rate: {
    high: 'Try to slow your breathing: breathe in slowly for 4 counts, hold for 2, breathe out for 6. Sit upright. Rest and avoid exertion. Re-check in 5 minutes. If breathing difficulty persists, contact medical support.',
    low:  'Take several deep breaths to stimulate normal breathing rhythm. Sit upright. Rest. Re-check in 5 minutes. If you feel drowsy or confused, contact medical support immediately.',
  },
  radiation_dose: {
    high: 'Move away from the current area if possible. Check suit/shield integrity if in a spacecraft. Log the exposure. Report to mission control. Do not ignore elevated radiation — cumulative exposure has long-term health effects.',
    low:  'No action needed. Continue monitoring.',
  },
  sleep_hours: {
    high: 'No immediate action needed. Monitor for other symptoms such as fever, fatigue, or low mood. If prolonged excessive sleep continues for more than 2 days, report to medical or mission support.',
    low:  'Prioritise sleep in your next rest period. Avoid stimulants in the hours before sleep. Do not perform high-risk or complex tasks requiring full concentration until rested. If sleep deprivation has lasted 3 or more days, report to medical or mission support — it significantly impairs decision-making.',
  },
  mood: {
    high: 'No action needed. Continue monitoring.',
    low:  'Take a short break from work. Eat a meal and drink water if you have not done so recently. Talk to a crewmate or someone you trust — isolation makes low mood worse. Avoid making major decisions while feeling this way. If low mood persists for more than 2 consecutive days, or if you feel hopeless or unable to function, report to medical or mission support immediately.',
  },
};

// Appended to every alert's guidance text so the escalation step
// names the right support contact for each environment.
function escalation(environment: string): string {
  return environment === 'space'
    ? ' If condition does not improve or you feel worse, contact mission control or the flight surgeon immediately.'
    : ' If condition does not improve or you feel worse, seek the nearest clinic or call emergency services immediately.';
}

interface ExistingAlert {
  id: number;
}

export async function checkAnomaly(
  crewId: number,
  vitals: VitalsPayload,
  environment = 'space'
): Promise<void> {
  const vitalsToCheck = Object.keys(MESSAGES) as (keyof VitalsPayload)[];

  for (const vitalName of vitalsToCheck) {
    const value = vitals[vitalName];
    if (value === null || value === undefined) continue;

    const numericValue = value as number;
    const baseline = await getBaseline(crewId, vitalName as string);

    // No baseline yet (fewer than 20 readings) — skip, don't fire false alarms
    if (!baseline) continue;

    // z = (value - mean) / stddev
    // Tells us: how many standard deviations is this reading from this person's normal?
    const z = (numericValue - baseline.mean) / baseline.stddev;
    const absZ = Math.abs(z);

    // Determine severity based on how extreme the z-score is
    let severity: 'low' | 'medium' | 'high' | null = null;
    if      (absZ >= Z_THRESHOLDS.high)   severity = 'high';
    else if (absZ >= Z_THRESHOLDS.medium) severity = 'medium';
    else if (absZ >= Z_THRESHOLDS.low)    severity = 'low';

    if (!severity) {
      // Reading is within normal range — resolve any existing anomaly alert for this vital
      await query(
        `UPDATE alerts
         SET resolved_at = NOW()
         WHERE crew_id = $1
           AND vital_name = $2
           AND alert_type = 'anomaly'
           AND resolved_at IS NULL`,
        [crewId, vitalName]
      );
      continue;
    }

    // Check if there's already an active anomaly alert for this vital
    // Avoid flooding the alerts table with duplicate rows every 5 seconds
    const existing = await query<ExistingAlert>(
      `SELECT id FROM alerts
       WHERE crew_id = $1
         AND vital_name = $2
         AND alert_type = 'anomaly'
         AND resolved_at IS NULL
       LIMIT 1`,
      [crewId, vitalName]
    );

    if (existing.length > 0) {
      // Alert already active — just update severity if it escalated
      await query(
        `UPDATE alerts
         SET severity = $1, value = $2, z_score = $3
         WHERE id = $4`,
        [severity, numericValue, z, existing[0]!.id]
      );
      continue;
    }

    // New alert — insert it
    const direction = z > 0 ? 'high' : 'low';
    const message  = MESSAGES[vitalName as string]?.[direction] ?? 'Vital sign is outside your personal normal range.';
    const baseGuidance = GUIDANCE[vitalName as string]?.[direction] ?? 'Rest and re-check in 10 minutes.';
    const guidance = baseGuidance + escalation(environment);

    await query(
      `INSERT INTO alerts
        (crew_id, vital_name, alert_type, severity, message, guidance, value, z_score)
       VALUES ($1, $2, 'anomaly', $3, $4, $5, $6, $7)`,
      [crewId, vitalName, severity, message, guidance, numericValue, z]
    );

    console.log(`[Anomaly] crew=${crewId} vital=${vitalName} z=${z.toFixed(2)} severity=${severity}`);
  }
}
