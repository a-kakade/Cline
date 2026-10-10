import { timingSafeEqual } from "node:crypto";
import { AppError } from "./http";
export function requireJob(request: Request) {
  const secret = process.env.JOB_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-"))
    throw new AppError(
      503,
      "JOB_NOT_CONFIGURED",
      "Job authentication is not configured.",
    );
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    throw new AppError(401, "UNAUTHENTICATED", "Job authentication required.");
}
