import { roomService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () =>
    json(roomService().mine(await requireUser(request))),
  );
}
