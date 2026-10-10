"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ALERT_STATUS_LABELS } from "@/lib/alert-labels";
import type { Alert, AlertKind } from "@/lib/emergency-types";
import styles from "./home.module.css";

const KIND_LABELS: Record<AlertKind, string> = {
  sos: "SOS",
  journey_escalation: "Journey escalation",
  journey_all_clear: "Journey all-clear",
};

type State =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; alerts: Alert[] };

// Read-only list of this account's saved alerts. Status wording comes from the
// shared labels, so a simulation or provider acceptance is never called a
// delivery.
export function AlertsList() {
  const [result, setResult] = useState<State>({ state: "loading" });

  useEffect(() => {
    let active = true;
    apiRequest<Alert[]>("/api/sos").then(
      (alerts) => {
        if (active) setResult({ state: "ready", alerts });
      },
      () => {
        if (active) setResult({ state: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (result.state === "loading")
    return (
      <p role="status" className={styles.listNote}>
        Loading your alerts…
      </p>
    );
  if (result.state === "error")
    return (
      <p role="alert" className="form-error">
        We couldn’t load your alerts. Please try again.
      </p>
    );
  if (result.alerts.length === 0)
    return <p className={styles.listNote}>You haven’t sent any alerts yet.</p>;

  return (
    <ul className={styles.alertList}>
      {result.alerts.map((alert) => (
        <li key={alert.id}>
          <Link href={`/sos/${alert.id}`} className={styles.alertItem}>
            <strong>{KIND_LABELS[alert.kind]}</strong>
            <span>{ALERT_STATUS_LABELS[alert.status]}</span>
            <small>
              {new Date(alert.created_at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </small>
          </Link>
        </li>
      ))}
    </ul>
  );
}
