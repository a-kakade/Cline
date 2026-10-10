import Link from "next/link";
import type { SenderTriage } from "@/lib/room-types";
import { ACTION_LABELS, type SuggestedAction } from "@/lib/triage-types";
import { Icon } from "@/components/icon";

const ACTION_LINKS: Record<SuggestedAction, string> = {
  call_112: "tel:112",
  open_sos: "/dashboard#sos",
  nearby_help: "/services",
  share_journey: "/journeys",
  report_hazard: "/map",
  report_harassment: "/map",
};

// Shown only to the sender, after their own message. Automatic and possibly wrong.
export function TriageHelp({
  triage,
  onDismiss,
}: {
  triage: SenderTriage;
  onDismiss: () => void;
}) {
  if (!triage.suggested_actions.length) return null;
  return (
    <aside className="chat-help" aria-label="Suggested help">
      <p>
        <strong>Do you need help?</strong> These options are an automatic
        suggestion based on your message and may be wrong. SOS and 112 are
        always available.
        {triage.flagged_for_review &&
          " A moderator may review this message; no one has been contacted automatically."}
      </p>
      <div className="place-actions">
        {triage.suggested_actions.map((a) =>
          a === "call_112" ? (
            <a key={a} className="button button-danger" href={ACTION_LINKS[a]}>
              <Icon name="phone" /> {ACTION_LABELS[a]}
            </a>
          ) : (
            <Link
              key={a}
              className="button button-secondary"
              href={ACTION_LINKS[a]}
            >
              {ACTION_LABELS[a]}
            </Link>
          ),
        )}
        <button type="button" className="text-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}
