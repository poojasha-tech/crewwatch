import { VitalsPayload } from '../simulator/simulator';
import { updateBaseline } from './baseline';
import { checkAnomaly }   from './anomaly';
import { checkTrend }     from './trend';
import { updateRiskScore } from './riskScore';
import { broadcast }      from '../ws/broadcast';

// Called after every new reading — from simulator and manual POST /readings
// Runs all intelligence steps in order, then pushes results over WebSocket
export async function processReading(
  crewId:    number,
  readingId: number,
  vitals:    VitalsPayload
): Promise<void> {
  // Step 1 — update this person's rolling statistical baseline
  await updateBaseline(crewId, vitals);

  // Step 2 — check for single-reading anomalies (z-score)
  await checkAnomaly(crewId, vitals);

  // Step 3 — check for gradual trends (linear regression slope)
  await checkTrend(crewId, vitals);

  // Step 4 — recalculate composite risk score from all active alerts
  const risk = await updateRiskScore(crewId);

  // Step 5 — broadcast the new reading + updated risk score to all dashboard clients
  broadcast({
    type:      'reading',
    crewId,
    readingId,
    vitals,
    riskScore: risk.score,
    riskLevel: risk.level,
  });
}
