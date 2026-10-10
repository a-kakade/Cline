export function config() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const url = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || secret.startsWith("replace-"))
    throw new Error(
      "Configure BETTER_AUTH_SECRET with at least 32 random characters.",
    );
  if (!url) throw new Error("Configure BETTER_AUTH_URL.");
  const parsed = new URL(url);
  if (
    process.env.NODE_ENV === "production" &&
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
    throw new Error("Production requires HTTPS.");
  return {
    secret,
    url: parsed.origin,
    databasePath: process.env.DATABASE_PATH || "./data/sakhi.sqlite",
  };
}
