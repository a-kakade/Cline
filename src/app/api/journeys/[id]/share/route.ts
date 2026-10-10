import { journeyService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const { id } = await context.params;
    return json(await journeyService().share(user, id, await body(request)));
  });
}
