import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { allHotspots } from "@/lib/hotspots";
import { MapExplorer } from "@/components/map-explorer";

export const metadata: Metadata = {
  title: "Safety map",
  robots: { index: false, follow: false },
};

export default async function MapPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";
  const tileUrl =
    process.env.MAP_TILE_URL ??
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const hotspots = allHotspots();
  return (
    <div className="container map-page">
      <header className="map-heading">
        <h1>
          Safety <span className="serif-accent">map.</span>
        </h1>
        <p>Area ratings from what people say in local rooms. Demo data.</p>
      </header>
      <MapExplorer
        tileUrl={tileUrl}
        emergencyNumber={emergencyNumber}
        hotspots={hotspots}
      />
    </div>
  );
}
