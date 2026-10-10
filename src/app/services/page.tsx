import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { demoAllowed } from "@/server/places/service";
import { EmergencyHelp } from "@/components/emergency-help";
import { ServicesFinder } from "@/components/services-finder";

export const metadata: Metadata = {
  title: "Nearby help",
  robots: { index: false, follow: false },
};

export default async function ServicesPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";
  return (
    <div className="container journey-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <header className="contacts-heading">
        <p className="eyebrow">FIND HELP FAST</p>
        <h1>
          Nearby <span className="serif-accent">help.</span>
        </h1>
        <p>
          Police stations, hospitals, pharmacies, bus stops, washrooms and
          verified Safe Havens near you, nearest first. Details appear only
          where they are mapped.
        </p>
      </header>
      <ServicesFinder
        emergencyNumber={emergencyNumber}
        demoAllowed={demoAllowed()}
      />
      <p>
        <Link className="text-link" href="/map">
          Open the full safety map
        </Link>
      </p>
      <EmergencyHelp emergencyNumber={emergencyNumber} />
    </div>
  );
}
