import { z } from "zod";
import { roomService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
const schema = z.object({ muted: z.boolean() }).strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const { muted } = schema.parse(await body(request));
    return json(roomService().mute(user, (await context.params).id, muted));
  });
}
