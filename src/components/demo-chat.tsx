import { agoLabel, type ChatLine } from "@/lib/hotspots";

// Synthetic conversation shown to everyone, joined or not. Clearly labelled.
export function DemoChat({ chats, area }: { chats: ChatLine[]; area: string }) {
  return (
    <section aria-labelledby="demo-chat-heading">
      <p className="demo-badge">DEMO CONVERSATION</p>
      <h3 id="demo-chat-heading">What people in {area} are saying</h3>
      <p className="field-hint">
        Synthetic messages written for this demo. They are not from real people
        and did not happen.
      </p>
      <ul className="demo-chat" aria-label={`Demo messages for ${area}`}>
        {chats.map((c, i) => (
          <li
            key={i}
            className={`demo-msg${c.sentiment > 0.1 ? " demo-msg-good" : c.sentiment < -0.1 ? " demo-msg-bad" : ""}`}
          >
            <header>
              <span>{c.alias}</span>
              <span>{agoLabel(c.minutes_ago)}</span>
            </header>
            {c.body}
          </li>
        ))}
      </ul>
    </section>
  );
}
