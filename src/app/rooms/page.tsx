import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { EmergencyHelp } from "@/components/emergency-help";
import { allHotspots, allPosts } from "@/lib/hotspots";
import { CommunityHub } from "@/components/community-hub";

export const metadata: Metadata = {
  title: "Community",
  robots: { index: false, follow: false },
};

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string | string[] }>;
}) {
  const { area } = await searchParams;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";
  const hotspots = allHotspots();
  return (
    <div className="container journey-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <header className="community-heading">
        <h1>
          Your <span className="serif-accent">community.</span>
        </h1>
        <p>Support, learn, and stay connected with people in your area.</p>
      </header>
      <CommunityHub
        hotspots={hotspots}
        posts={allPosts()}
        initialAreaId={typeof area === "string" ? area : undefined}
      />
      <EmergencyHelp emergencyNumber={emergencyNumber} />
    </div>
  );
}
