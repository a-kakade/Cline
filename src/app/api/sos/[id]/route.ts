import { getDatabase } from "@/server/database";
import { EmergencyService } from "@/server/emergency";
import { selectProvider } from "@/server/notifications";
import { endpoint, json, requireUser } from "@/server/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new EmergencyService(getDatabase(), selectProvider()).get(
        user,
        (await context.params).id,
      ),
    );
  });
}
