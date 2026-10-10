import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { Icon } from "@/components/icon";
import { SignOutButton } from "@/components/sign-out-button";
import { SimulationNotice } from "@/components/simulation-notice";
import { SosControl } from "@/components/sos-control";

export const metadata: Metadata = {
  title: "My account",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  const configured = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configured && /^\+?\d{1,15}$/.test(configured) ? configured : "112";

  return (
    <div className="container dashboard-page">
      <div className="dashboard-heading">
        <div>
          <h1>
            Welcome,{" "}
            <span className="serif-accent">
              {session.user.name || "friend"}.
            </span>
          </h1>
        </div>
      </div>
      <SimulationNotice compact brief />
      <SosControl emergencyNumber={emergencyNumber} />
      <div className="dashboard-grid">
        <section className="account-card" aria-labelledby="account-heading">
          <div className="card-heading">
            <span className="icon-tile">
              <Icon name="lock" />
            </span>
            <span className="session-badge">
              <Icon name="check" /> Signed in
            </span>
          </div>
          <h2 id="account-heading">Your details</h2>
          <dl className="account-details">
            <div>
              <dt>Name</dt>
              <dd>{session.user.name || "Not provided"}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{session.user.email}</dd>
            </div>
          </dl>
          <p className="card-note">
            Using a shared device? Sign out before you leave.
          </p>
          <SignOutButton />
        </section>
        <section
          className="account-card account-context"
          aria-labelledby="context-heading"
        >
          <span className="icon-tile">
            <Icon name="spark" />
          </span>
          <p className="eyebrow">THE PEOPLE YOU CHOOSE</p>
          <h2 id="context-heading">Your trusted contacts.</h2>
          <p>
            Save and manage the people you trust. Sharing permission is off by
            default, and saving a contact sends nothing. Numbers are not
            verified.
          </p>
          <p>
            The emergency link in the header opens your device’s dialer. You’ll
            need to place the call yourself, using a device that supports
            calling.
          </p>
          <Link className="text-link" href="/contacts">
            Manage trusted contacts <Icon name="arrow" />
          </Link>
        </section>
      </div>
    </div>
  );
}
