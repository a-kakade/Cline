import type { NextConfig } from "next";
// Map tiles are loaded by the browser straight from the tile host, so that origin
// must be allowed by the CSP. Defaults to the public OSM tile server (development
// and demo scale only; see docs/DATA_SOURCES.md for the usage policy).
const tileUrl =
  process.env.MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileOrigin = (() => {
  try {
    return new URL(tileUrl.replace(/\{[a-z]\}/g, "a")).origin;
  } catch {
    return "";
  }
})();
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${tileOrigin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
