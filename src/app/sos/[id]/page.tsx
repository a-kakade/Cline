import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { SosStatus } from "@/components/sos-status";
import { SimulationNotice } from "@/components/simulation-notice";

export const metadata: Metadata = {
  title: "SOS status",
  robots: { index: false, follow: false },
};

export default async function SosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const { id } = await params;
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";
  return (
    <div className="container sos-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <header className="contacts-heading">
        <p className="eyebrow">CLEAR ABOUT EVERY OUTCOME</p>
        <h1>
          SOS <span className="serif-accent">status.</span>
        </h1>
        <p>
          This is the saved record of your alert, not a promise that help will
          arrive.
        </p>
      </header>
      <SimulationNotice />
      <SosStatus id={id} emergencyNumber={emergencyNumber} />
    </div>
  );
}
