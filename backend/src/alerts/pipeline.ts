import { VitalsPayload } from '../simulator/simulator';
import { query }          from '../db/pool';
import { updateBaseline } from './baseline';
import { checkAnomaly }   from './anomaly';
import { checkTrend }     from './trend';
import { checkCombinations } from './combinations';
import { updateRiskScore } from './riskScore';
import { broadcast }      from '../ws/broadcast';

export async function processReading(
  crewId:    number,
  readingId: number,
  vitals:    VitalsPayload
): Promise<void> {
  // Look up environment once — passed to alert detectors for context-specific guidance
  const rows = await query<{ environment: string }>(
    'SELECT environment FROM crew WHERE id = $1', [crewId]
  );
  const environment = rows[0]?.environment ?? 'space';

  await updateBaseline(crewId, vitals);
  await checkAnomaly(crewId, vitals, environment);
  await checkTrend(crewId, vitals, environment);
  await checkCombinations(crewId, environment);

  const risk = await updateRiskScore(crewId);

  broadcast({ type: 'reading', crewId, readingId, vitals, riskScore: risk.score, riskLevel: risk.level });
}
