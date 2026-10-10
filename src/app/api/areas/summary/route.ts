import { areaSafetyService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";
import { queryObject } from "@/server/query";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const input = queryObject(request, {
      lat: "number",
      lon: "number",
      since_days: "number",
      include_demo: "bool",
    });
    return json(areaSafetyService().summarize(user, input));
  });
}
