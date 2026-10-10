import { ratingService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(ratingService().summary(user, (await context.params).id));
  });
}
