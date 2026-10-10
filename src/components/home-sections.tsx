"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { useHomeData } from "@/components/home-data";
import { ALERT_STATUS_LABELS } from "@/lib/alert-labels";
import type { Alert, AlertKind } from "@/lib/emergency-types";
import styles from "./home.module.css";

const KIND_LABELS: Record<AlertKind, string> = {
  sos: "SOS",
  journey_escalation: "Journey escalation",
  journey_all_clear: "Journey all-clear",
};

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function summary(alert: Alert) {
  return `${KIND_LABELS[alert.kind]} · ${ALERT_STATUS_LABELS[alert.status]}`;
}

// The card inside the hero. It reports what this account actually has (saved
// contacts and the last alert) and never claims the person is safe.
export function HomeStatusCard() {
  const { contacts, alerts } = useHomeData();

  let badge = "Checking";
  let tone = styles.badgeNeutral;
  let detail = "Checking your trusted contacts…";
  if (contacts.state === "error") {
    badge = "Unavailable";
    detail = "We couldn’t load your contacts.";
  } else if (contacts.state === "ready") {
    const sharing = contacts.data.filter((c) => c.alert_enabled).length;
    badge = sharing > 0 ? "Contacts ready" : "Set up contacts";
    tone = sharing > 0 ? styles.badgeGood : styles.badgeWarn;
    detail = `${contacts.data.length} saved · ${sharing} can receive alerts`;
  }

  let last = "Checking your alerts…";
  if (alerts.state === "error") last = "We couldn’t load your alerts.";
  else if (alerts.state === "ready")
    last =
      alerts.data.length > 0
        ? `${summary(alerts.data[0])} · ${when(alerts.data[0].created_at)}`
        : "No alerts sent yet.";

  return (
    <section className={styles.status} aria-label="Your status">
      <div className={styles.statusRow}>
        <span className={styles.statusIcon}>
          <Icon name="people" />
        </span>
        <div className={styles.statusText}>
          <strong>Trusted contacts</strong>
          <span>{detail}</span>
        </div>
        <span className={`${styles.badge} ${tone}`}>{badge}</span>
      </div>
      <div className={styles.statusRow}>
        <span className={styles.statusIcon}>
          <Icon name="shield" />
        </span>
        <div className={styles.statusText}>
          <strong>Last alert</strong>
          <span>{last}</span>
        </div>
      </div>
    </section>
  );
}

export function HomeAlertsBanner() {
  const { alerts } = useHomeData();

  let title = "Alerts";
  let body = "Checking your alerts…";
  if (alerts.state === "error") {
    body = "We couldn’t load your alerts. You can still open the alerts page.";
  } else if (alerts.state === "ready") {
    if (alerts.data.length > 0) {
      title = `Recent alerts (${alerts.data.length})`;
      body = `${summary(alerts.data[0])} · ${when(alerts.data[0].created_at)}`;
    } else {
      body =
        "Nothing has been sent. Alerts you send, or that Journey Guardian raises, appear here.";
    }
  }

  return (
    <section className={styles.alerts} aria-label="Alerts summary">
      <span className={styles.alertsIcon}>
        <Icon name="siren" />
      </span>
      <div className={styles.alertsBody}>
        <h2>{title}</h2>
        <p>{body}</p>
        <Link href="/alerts" className={styles.alertsLink}>
          View all alerts <Icon name="arrow" width={16} height={16} />
        </Link>
      </div>
    </section>
  );
}

export function HomeContactsTile() {
  const { contacts } = useHomeData();
  let sub = "Checking…";
  if (contacts.state === "error") sub = "Unavailable right now";
  else if (contacts.state === "ready")
    sub =
      contacts.data.length === 0
        ? "None saved yet"
        : `${contacts.data.length} saved`;

  return (
    <Link href="/contacts" className={styles.tile}>
      <span className={`${styles.tileIcon} ${styles.toneSage}`}>
        <Icon name="people" />
      </span>
      <strong>My contacts</strong>
      <small>{sub}</small>
      <span className={`${styles.tileCta} ${styles.ctaSage}`}>
        View all <Icon name="arrow" width={14} height={14} />
      </span>
    </Link>
  );
}
