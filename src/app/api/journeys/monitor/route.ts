import { getDatabase } from "@/server/database";
import { monitorStatus } from "@/server/heartbeat";
import { endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
// Whether the scheduled job that escalates overdue journeys has run recently.
export async function GET(request: Request) {
  return endpoint(async () => {
    await requireUser(request);
    return json(monitorStatus(getDatabase(), "jobs"));
  });
}
