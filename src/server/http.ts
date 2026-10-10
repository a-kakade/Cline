import { ZodError } from "zod";
import { getAuth } from "./auth";
import { config } from "./config";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(
    { data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function endpoint(fn: () => Promise<Response> | Response) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: error.issues.map((i) => i.message).join(" "),
          },
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof AppError)
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      {
        error: {
          code: "UNAVAILABLE",
          message:
            "This request could not be completed. Please try again. Emergency calling remains available.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function requireUser(request: Request) {
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== config().url
  )
    throw new AppError(403, "ORIGIN", "Request origin is not allowed.");
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Sign in to continue. You can still call emergency services.",
    );
  return session.user.id;
}
export async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError(415, "CONTENT_TYPE", "Send JSON data.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "BODY", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new AppError(413, "TOO_LARGE", "Request is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError(400, "JSON", "Request must be valid JSON.");
  }
}
