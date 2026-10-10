import { getDatabase } from "@/server/database";
import { EmergencyService } from "@/server/emergency";
import { selectProvider } from "@/server/notifications";
import { body, endpoint, json, requireUser } from "@/server/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      await new EmergencyService(getDatabase(), selectProvider()).dispatch(
        user,
        (await context.params).id,
        await body(request),
      ),
    );
  });
}
