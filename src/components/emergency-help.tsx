import { Icon } from "@/components/icon";

// Always-available, user-initiated call links. Rendered on every safety page and
// never dependent on location, maps, chat or AI.
export function EmergencyHelp({
  emergencyNumber = "112",
}: {
  emergencyNumber?: string;
}) {
  return (
    <aside className="emergency-help" aria-label="Emergency help">
      <a className="button button-danger" href={`tel:${emergencyNumber}`}>
        <Icon name="phone" />
        Call {emergencyNumber} — emergency
      </a>
      <a className="button button-secondary" href="tel:181">
        <Icon name="phone" />
        Women Helpline 181
      </a>
      <p>
        These open your phone&rsquo;s dialer; you place the call. SAKHI messages
        to your contacts do not alert the police or any emergency service.
      </p>
    </aside>
  );
}
