import { z } from "zod";
import { JOURNEY_ACTIONS } from "@/lib/journey-state";
import { journeyService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";

export const runtime = "nodejs";
const actionSchema = z.enum(JOURNEY_ACTIONS as [string, ...string[]]);
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const params = await context.params;
    return json(
      await journeyService().transitionAndNotify(
        user,
        params.id,
        actionSchema.parse(params.action) as never,
        await body(request),
      ),
    );
  });
}
