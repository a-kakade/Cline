import { getDatabase } from "@/server/database";
import { EmergencyService } from "@/server/emergency";
import { selectProvider } from "@/server/notifications";
import { endpoint, json } from "@/server/http";
import { requireJob } from "@/server/job-auth";
import { applyRetention } from "@/server/retention";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    requireJob(request);
    const db = getDatabase();
    const retention = applyRetention(db);
    return json({
      ...(await new EmergencyService(db, selectProvider()).processPending()),
      retention,
    });
  });
}
