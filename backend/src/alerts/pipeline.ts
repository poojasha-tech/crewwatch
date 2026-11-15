import { VitalsPayload } from '../simulator/simulator';

// Stub — wired up fully in tasks 7–10
// Called after every new reading (from simulator and manual entry)
export async function processReading(
  crewId: number,
  readingId: number,
  vitals: VitalsPayload
): Promise<void> {
  // Task 7: updateBaseline(crewId, vitals)
  // Task 8: checkAnomaly(crewId, vitals)
  // Task 9: checkTrend(crewId, vitals)
  // Task 10: recalculateRiskScore(crewId)
  // Task 11: broadcast reading + any new alerts via WebSocket
}
