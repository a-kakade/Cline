import { roomService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      roomService().report(
        user,
        (await context.params).id,
        await body(request),
      ),
    );
  });
}
