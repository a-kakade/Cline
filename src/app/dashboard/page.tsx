import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { Icon } from "@/components/icon";
import { HomeAlertLink } from "@/components/home-alert-link";
import { HomeDataProvider } from "@/components/home-data";
import {
  HomeAlertsBanner,
  HomeContactsTile,
  HomeStatusCard,
} from "@/components/home-sections";
import styles from "@/components/home.module.css";
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
    <HomeDataProvider>
      <div className={`container ${styles.home}`}>
        <header className={styles.hero}>
          <div className={styles.heroTop}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>YOUR SPACE. YOUR PACE.</p>
              <h1 className={styles.title}>
                Welcome,{" "}
                <span className="serif-accent">
                  {session.user.name || "friend"}.
                </span>
              </h1>
              <p className={styles.subtitle}>
                Here’s what’s on your account today.
              </p>
            </div>
            <HomeAlertLink />
          </div>
          <HomeStatusCard />
        </header>

        <SimulationNotice compact brief />
        <SosControl emergencyNumber={emergencyNumber} />
        <HomeAlertsBanner />

        <Link href="/journeys" className={styles.cta}>
          <span className={styles.ctaLabel}>
            <Icon name="route" /> Plan a trip
          </span>
          <Icon name="arrow" />
        </Link>

        <div className={styles.tiles}>
          <Link href="/map" className={styles.tile}>
            <span className={`${styles.tileIcon} ${styles.tonePink}`}>
              <Icon name="map" />
            </span>
            <strong>Safety map</strong>
            <small>Area ratings and nearby help</small>
            <span className={`${styles.tileCta} ${styles.ctaPink}`}>
              Open <Icon name="arrow" width={14} height={14} />
            </span>
          </Link>
          <HomeContactsTile />
        </div>

        <Link href="/rooms" className={styles.community}>
          <span className={styles.communityIcon}>
            <Icon name="chat" />
          </span>
          <span className={styles.communityText}>
            <strong>Community rooms</strong>
            <span>Talk with people in your area.</span>
          </span>
          <Icon name="arrow" />
        </Link>

        <section className={styles.account} aria-labelledby="account-heading">
          <h2 id="account-heading">Your details</h2>
          <dl className={styles.accountDetails}>
            <div>
              <dt>Name</dt>
              <dd>{session.user.name || "Not provided"}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{session.user.email}</dd>
            </div>
          </dl>
          <p className={styles.accountNote}>
            Using a shared device? Sign out before you leave.
          </p>
          <SignOutButton />
        </section>
      </div>
    </HomeDataProvider>
  );
}
