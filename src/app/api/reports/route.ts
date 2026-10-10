import { reportService } from "@/server/services";
import { body, endpoint, json, requireUser } from "@/server/http";
import { queryObject } from "@/server/query";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    const input = queryObject(request, {
      lat: "number",
      lon: "number",
      radius_m: "number",
      since_days: "number",
      limit: "number",
      kinds: "list",
      include_demo: "bool",
    });
    return json(reportService().list(user, input));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(reportService().create(user, await body(request)), 201);
  });
}
