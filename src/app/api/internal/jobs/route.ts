import { getDatabase } from "@/server/database";
import { EmergencyService } from "@/server/emergency";
import { JourneyService } from "@/server/journeys";
import { selectProvider } from "@/server/notifications";
import { recordHeartbeat } from "@/server/heartbeat";
import { endpoint, json } from "@/server/http";
import { requireJob } from "@/server/job-auth";
import { applyRetention } from "@/server/retention";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    requireJob(request);
    const db = getDatabase();
    const retention = applyRetention(db);
    const emergency = new EmergencyService(db, selectProvider());
    // Journeys first: escalations queue alerts that the same run then sends.
    const journeys = new JourneyService(db, emergency).processOverdue();
    const pending = await emergency.processPending();
    recordHeartbeat(db, "jobs");
    return json({ ...pending, journeys, retention });
  });
}
