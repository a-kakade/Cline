import { getDatabase } from "@/server/database";
import { EmergencyService } from "@/server/emergency";
import { selectProvider } from "@/server/notifications";
import { body, endpoint, json, requireUser } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new EmergencyService(getDatabase(), selectProvider()).list(user),
    );
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new EmergencyService(getDatabase(), selectProvider()).create(
        user,
        await body(request),
      ),
      201,
    );
  });
}
