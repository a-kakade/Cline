import { moderationService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () =>
    json(moderationService().queue(await requireUser(request))),
  );
}
