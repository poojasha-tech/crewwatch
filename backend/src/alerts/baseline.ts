import { query } from '../db/pool';
import { VitalsPayload } from '../simulator/simulator';

// Vitals we track baselines for — matches column names in vitals_readings
const TRACKED_VITALS: (keyof VitalsPayload)[] = [
  'heart_rate',
  'systolic_bp',
  'diastolic_bp',
  'spo2',
  'body_temp',
  'respiration_rate',
  'radiation_dose',
  'sleep_hours',
  'mood',
];

interface BaselineRow {
  mean: number;
  stddev: number;
  sample_count: number;
}

// Welford's online algorithm — updates mean and stddev in O(1) without storing all readings
// Formula:
//   new_count  = old_count + 1
//   delta      = new_value - old_mean
//   new_mean   = old_mean + delta / new_count
//   delta2     = new_value - new_mean         (recalculated with new mean)
//   new_M2     = old_M2 + delta * delta2      (M2 = sum of squared deviations)
//   new_stddev = sqrt(new_M2 / new_count)
function welford(
  oldMean: number,
  oldM2: number,
  oldCount: number,
  newValue: number
): { mean: number; M2: number; stddev: number; count: number } {
  const count  = oldCount + 1;
  const delta  = newValue - oldMean;
  const mean   = oldMean + delta / count;
  const delta2 = newValue - mean;
  const M2     = oldM2 + delta * delta2;
  const stddev = count > 1 ? Math.sqrt(M2 / count) : 1; // stddev=1 until we have 2+ readings

  return { mean, M2, stddev, count };
}

// Called after every new reading — updates the baseline for each vital of this crew member
export async function updateBaseline(
  crewId: number,
  vitals: VitalsPayload
): Promise<void> {
  for (const vitalName of TRACKED_VITALS) {
    const value = vitals[vitalName];

    // Skip nulls — not every reading has every vital (e.g. village user with no radiation sensor)
    if (value === null || value === undefined) continue;

    const numericValue = value as number;

    // Fetch the current baseline row for this person + vital
    const rows = await query<BaselineRow & { m2: number }>(
      `SELECT mean, stddev, sample_count,
              -- Reconstruct M2 from stddev and count so Welford can continue
              CASE WHEN sample_count > 1
                   THEN stddev * stddev * sample_count
                   ELSE 0
              END AS m2
       FROM baselines
       WHERE crew_id = $1 AND vital_name = $2`,
      [crewId, vitalName]
    );

    if (rows.length === 0) {
      // First reading for this person + vital — insert a new baseline row
      await query(
        `INSERT INTO baselines (crew_id, vital_name, mean, stddev, sample_count)
         VALUES ($1, $2, $3, 1, 1)`,
        [crewId, vitalName, numericValue]
      );
    } else {
      const row = rows[0]!;
      const { mean, M2, stddev, count } = welford(
        Number(row.mean),
        Number(row.m2),
        Number(row.sample_count),
        numericValue
      );

      await query(
        `UPDATE baselines
         SET mean = $1, stddev = $2, sample_count = $3, updated_at = NOW()
         WHERE crew_id = $4 AND vital_name = $5`,
        [mean, stddev, count, crewId, vitalName]
      );
    }
  }
}

// Returns the current baseline for one crew member + vital, or null if not enough data yet
export async function getBaseline(
  crewId: number,
  vitalName: string
): Promise<BaselineRow | null> {
  const rows = await query<BaselineRow>(
    `SELECT mean, stddev, sample_count
     FROM baselines
     WHERE crew_id = $1 AND vital_name = $2`,
    [crewId, vitalName]
  );

  if (rows.length === 0) return null;

  const row = rows[0]!;
  // Don't return a baseline until we have enough readings to trust it
  if (Number(row.sample_count) < 20) return null;

  return {
    mean:         Number(row.mean),
    // Floor at 0.1 — prevents division-by-zero when all readings are identical
    // (e.g. mood always = 4). With floor, z = (1 - 4) / 0.1 = -30 → high severity.
    stddev:       Math.max(Number(row.stddev), 0.1),
    sample_count: Number(row.sample_count),
  };
}
