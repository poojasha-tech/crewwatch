import { query } from '../db/pool';
import { processReading } from '../alerts/pipeline';

// NASA-STD-3001 Vol. 2 normal ranges for space crew
// Village users use same vitals but no radiation_dose
const RANGES = {
  heart_rate:       { min: 55,   max: 85   },
  systolic_bp:      { min: 100,  max: 130  },
  diastolic_bp:     { min: 65,   max: 85   },
  spo2:             { min: 96,   max: 99   },
  body_temp:        { min: 36.2, max: 37.1 },
  respiration_rate: { min: 13,   max: 18   },
  radiation_dose:   { min: 0.1,  max: 0.4  },
};

// Box-Muller transform: generates a Gaussian (bell-curve) random number
// This makes vitals fluctuate naturally around a midpoint, not randomly jump around
function gaussianNoise(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round((mean + z * stddev) * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function midpoint(r: { min: number; max: number }): number {
  return (r.min + r.max) / 2;
}

function spread(r: { min: number; max: number }): number {
  return (r.max - r.min) / 6;
}

// Tracks whether a crew member is currently experiencing a simulated health event
const anomalyState: Record<number, { type: string; step: number } | null> = {};

export type VitalsPayload = {
  heart_rate: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  spo2: number | null;
  body_temp: number | null;
  respiration_rate: number | null;
  radiation_dose: number | null;
  sleep_hours: number | null;
  mood: number | null;
};

function generateVitals(crewId: number, environment: string): VitalsPayload {
  // 5% chance per tick of starting a new health event (if none already active)
  if (!anomalyState[crewId] && Math.random() < 0.05) {
    const types = ['bp_rise', 'spo2_drop', 'fever', 'tachy'];
    anomalyState[crewId] = {
      type: types[Math.floor(Math.random() * types.length)]!,
      step: 0,
    };
    console.log(`[Simulator] Anomaly started for crew ${crewId}: ${anomalyState[crewId]!.type}`);
  }

  const anomaly = anomalyState[crewId];
  if (anomaly) anomaly.step++;

  // Reset after 30 steps (~2.5 minutes)
  if (anomaly && anomaly.step > 30) {
    console.log(`[Simulator] Anomaly resolved for crew ${crewId}`);
    anomalyState[crewId] = null;
  }

  // Generate baseline vitals with natural Gaussian noise
  let heart_rate       = gaussianNoise(midpoint(RANGES.heart_rate),       spread(RANGES.heart_rate));
  let systolic_bp      = gaussianNoise(midpoint(RANGES.systolic_bp),      spread(RANGES.systolic_bp));
  let diastolic_bp     = gaussianNoise(midpoint(RANGES.diastolic_bp),     spread(RANGES.diastolic_bp));
  let spo2             = gaussianNoise(midpoint(RANGES.spo2),             spread(RANGES.spo2));
  let body_temp        = gaussianNoise(midpoint(RANGES.body_temp),        spread(RANGES.body_temp));
  let respiration_rate = gaussianNoise(midpoint(RANGES.respiration_rate), spread(RANGES.respiration_rate));

  // Apply anomaly drift — values gradually worsen each step
  if (anomaly) {
    const drift = anomaly.step * 0.5;
    if (anomaly.type === 'bp_rise')   systolic_bp  += drift;
    if (anomaly.type === 'spo2_drop') spo2         -= drift * 0.3;
    if (anomaly.type === 'fever')     body_temp    += drift * 0.05;
    if (anomaly.type === 'tachy')     heart_rate   += drift;
  }

  return {
    heart_rate:       clamp(heart_rate,       30,  200),
    systolic_bp:      clamp(systolic_bp,      70,  200),
    diastolic_bp:     clamp(diastolic_bp,     40,  130),
    spo2:             clamp(spo2,             70,  100),
    body_temp:        clamp(body_temp,        35,  42),
    respiration_rate: clamp(respiration_rate, 5,   40),
    radiation_dose:   environment === 'space'
      ? gaussianNoise(midpoint(RANGES.radiation_dose), spread(RANGES.radiation_dose))
      : null,
    sleep_hours: null,
    mood:        null,
  };
}

interface CrewRow {
  id: number;
  environment: string;
}

interface InsertedRow {
  id: number;
}

export async function startSimulator(): Promise<void> {
  console.log('[Simulator] Starting — generating vitals every 5 seconds');

  const tick = async () => {
    try {
      const crew = await query<CrewRow>('SELECT id, environment FROM crew');

      for (const member of crew) {
        const vitals = generateVitals(member.id, member.environment);

        const rows = await query<InsertedRow>(
          `INSERT INTO vitals_readings
            (crew_id, heart_rate, systolic_bp, diastolic_bp, spo2,
             body_temp, respiration_rate, radiation_dose, sleep_hours, mood, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'simulator')
           RETURNING id`,
          [
            member.id,
            vitals.heart_rate,
            vitals.systolic_bp,
            vitals.diastolic_bp,
            vitals.spo2,
            vitals.body_temp,
            vitals.respiration_rate,
            vitals.radiation_dose,
            vitals.sleep_hours,
            vitals.mood,
          ]
        );

        const readingId = rows[0]?.id;
        if (readingId !== undefined) {
          await processReading(member.id, readingId, vitals);
        }
      }
    } catch (err) {
      console.error('[Simulator] Tick error:', err);
    }
  };

  await tick();
  setInterval(tick, 5000);
}
