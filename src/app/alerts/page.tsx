import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { AlertsList } from "@/components/alerts-list";
import styles from "@/components/home.module.css";

export const metadata: Metadata = {
  title: "Alerts",
  robots: { index: false, follow: false },
};

export default async function AlertsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");

  return (
    <div className={`container ${styles.home}`}>
      <Link className="text-link" href="/dashboard">
        Back to home
      </Link>
      <header>
        <h1 className={styles.listTitle}>
          Your <span className="serif-accent">alerts.</span>
        </h1>
        <p className={styles.listNote}>
          The saved record of alerts on your account. A saved alert is not a
          promise that help will arrive.
        </p>
      </header>
      <AlertsList />
    </div>
  );
}
