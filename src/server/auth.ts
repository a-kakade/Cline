import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type Database from "better-sqlite3";
import { config } from "./config";
import { getDatabase } from "./database";

// Only the isolated E2E runner may raise auth limits (via AUTH_RATE_LIMIT_MAX);
// production always keeps the strict defaults (30/min general, 3/10s sign-in/up).
function authRateLimitOverride() {
  const override = Number(process.env.AUTH_RATE_LIMIT_MAX);
  return process.env.NODE_ENV !== "production" &&
    Number.isInteger(override) &&
    override >= 30
    ? override
    : null;
}

export function createAuth(database: Database.Database) {
  const env = config();
  return betterAuth({
    database,
    secret: env.secret,
    baseURL: env.url,
    trustedOrigins: [env.url],
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: authRateLimitOverride() ?? 30,
      // Read-only session hydration is frequent on shared NATs; keep credential
      // endpoints on the stricter provider/default limits.
      customRules: {
        "/get-session": { window: 60, max: 300 },
        ...(authRateLimitOverride()
          ? {
              "/sign-up/*": { window: 10, max: authRateLimitOverride()! },
              "/sign-in/*": { window: 10, max: authRateLimitOverride()! },
            }
          : {}),
      },
    },
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.request &&
          !["GET", "HEAD"].includes(ctx.request.method) &&
          ctx.request.headers.get("origin") !== env.url
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Request origin is not allowed.",
          });
        }
      }),
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth(getDatabase()));
}
