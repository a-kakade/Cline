import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { ContactsManager } from "@/components/contacts-manager";
import { SimulationNotice } from "@/components/simulation-notice";

export const metadata: Metadata = {
  title: "Trusted contacts",
  robots: { index: false, follow: false },
};

export default async function ContactsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth");

  return (
    <div className="container contacts-page">
      <Link className="text-link" href="/dashboard">
        Back to my account
      </Link>
      <header className="contacts-heading">
        <p className="eyebrow">THE PEOPLE YOU CHOOSE</p>
        <h1>
          Your trusted <span className="serif-accent">contacts.</span>
        </h1>
        <p>
          Keep the people you trust in one place. You decide who is saved and
          who has sharing permission.
        </p>
      </header>
      <ContactsManager />
      <SimulationNotice />
    </div>
  );
}
