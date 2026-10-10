import { z } from "zod";
import { MAX_RADIUS_M, servicesNear, SNAPSHOT } from "@/lib/services";
import { endpoint, json, requireUser } from "@/server/http";
import { queryObject } from "@/server/query";

export const runtime = "nodejs";
const schema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(100).max(MAX_RADIUS_M).default(3000),
  })
  .strict();

export async function GET(request: Request) {
  return endpoint(async () => {
    await requireUser(request);
    const q = schema.parse(
      queryObject(request, {
        lat: "number",
        lon: "number",
        radius_m: "number",
      }),
    );
    return json({
      services: servicesNear(q, q.radius_m),
      snapshot_date: SNAPSHOT.fetched_at,
      attribution: SNAPSHOT.attribution,
    });
  });
}
