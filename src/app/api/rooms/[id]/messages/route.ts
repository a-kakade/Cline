import { roomService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";
import { queryObject } from "@/server/query";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const query = queryObject(request, { before: "number", limit: "number" });
    return json(roomService().history(user, (await context.params).id, query));
  });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      roomService().post(user, (await context.params).id, await body(request)),
      201,
    );
  });
}
