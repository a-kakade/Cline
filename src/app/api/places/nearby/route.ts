import { placesService } from "@/server/services";
import { endpoint, json, requireUser } from "@/server/http";
import { queryObject } from "@/server/query";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const input = queryObject(request, {
      lat: "number",
      lon: "number",
      radius_m: "number",
      per_category: "number",
      categories: "list",
      include_demo: "bool",
    });
    return json(await placesService().nearby(user, input));
  });
}
