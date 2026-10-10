import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { allHotspots } from "@/lib/hotspots";
import { EmergencyHelp } from "@/components/emergency-help";
import { SimulationNotice } from "@/components/simulation-notice";
import { TripPage } from "@/components/trip-page";

export const metadata: Metadata = {
  title: "Trip",
  robots: { index: false, follow: false },
};

export default async function JourneysPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";
  const tileUrl =
    process.env.MAP_TILE_URL ??
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  return (
    <div className="container journey-page trip-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <SimulationNotice compact brief />
      <TripPage
        hotspots={allHotspots()}
        tileUrl={tileUrl}
        emergencyNumber={emergencyNumber}
      />
      <EmergencyHelp emergencyNumber={emergencyNumber} />
    </div>
  );
}
