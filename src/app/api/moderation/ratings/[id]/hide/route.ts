import { moderationService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      moderationService().hideRating(user, (await context.params).id),
    );
  });
}
