import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { ModerationService } from "@/server/moderation";
import { ModerationQueue } from "@/components/moderation-queue";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export default async function ModerationPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");
  // Not a moderator: behave as if the page doesn't exist.
  if (!new ModerationService(getDatabase()).isModerator(session.user.id))
    notFound();
  return (
    <div className="container journey-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <header className="contacts-heading">
        <p className="eyebrow">MODERATORS ONLY</p>
        <h1>
          Moderation <span className="serif-accent">queue.</span>
        </h1>
        <p>
          Flags come from automatic rules that miss many real emergencies and
          flag harmless messages. Nothing here contacts emergency services or
          the sender.
        </p>
      </header>
      <ModerationQueue />
    </div>
  );
}
