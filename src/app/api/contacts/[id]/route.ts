import { ContactService } from "@/server/contacts";
import { getDatabase } from "@/server/database";
import { body, endpoint, json, requireUser } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new ContactService(getDatabase()).update(
        user,
        (await context.params).id,
        await body(request),
      ),
    );
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    const user = await requireUser(request);
    return json(
      new ContactService(getDatabase()).delete(user, (await context.params).id),
    );
  });
}
