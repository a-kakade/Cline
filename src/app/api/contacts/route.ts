import { ContactService } from "@/server/contacts";
import { getDatabase } from "@/server/database";
import { body, endpoint, json, requireUser } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(async () =>
    json(new ContactService(getDatabase()).list(await requireUser(request))),
  );
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new ContactService(getDatabase()).create(user, await body(request)),
      201,
    );
  });
}
