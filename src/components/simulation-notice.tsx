import { Icon } from "@/components/icon";

export function SimulationNotice({
  compact = false,
  brief = false,
}: {
  compact?: boolean;
  brief?: boolean;
}) {
  const isSimulation =
    process.env.NODE_ENV !== "production" &&
    process.env.NOTIFICATION_PROVIDER === "simulation";

  return (
    <aside
      className={`simulation-notice${compact ? " simulation-notice-compact" : ""}`}
      aria-label="About this build"
    >
      <Icon name="shield" />
      <div>
        <p className="notice-title">
          {isSimulation
            ? "Local simulation. No real alerts."
            : "Notifications disabled. No real alerts."}
        </p>
        {brief ? (
          <p>
            No messages are sent. Optional location stays with your saved alert.
          </p>
        ) : (
          <p>
            Accounts, contacts, and alert records are real. This configuration
            does not send alerts, share your location, or dispatch help to
            anyone. If you opt in, location is saved with your alert on this
            server. Use the call link above to contact emergency services
            directly.
          </p>
        )}
      </div>
    </aside>
  );
}
