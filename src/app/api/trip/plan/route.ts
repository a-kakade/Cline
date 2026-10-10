import { tripService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(await tripService().plan(user, await body(request)));
  });
}
