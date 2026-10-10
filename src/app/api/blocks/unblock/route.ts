import { roomService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(roomService().unblock(user, await body(request)));
  });
}
