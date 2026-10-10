import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";
import { AuthForm } from "@/components/auth-form";
import { Icon } from "@/components/icon";
import { SimulationNotice } from "@/components/simulation-notice";

export const metadata: Metadata = { title: "Your account" };

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  const { mode } = await searchParams;

  return (
    <div className="container auth-page">
      <div className="auth-story">
        <p className="eyebrow">
          <span className="eyebrow-line" /> A LITTLE SPACE FOR YOU
        </p>
        <h1>
          A familiar place.
          <br />A <span className="serif-accent">fresh start.</span>
        </h1>
        <p className="auth-description">
          One account. A simple beginning. Take a moment to make yourself at
          home.
        </p>
        <div className="auth-value">
          <span className="icon-tile">
            <Icon name="lock" />
          </span>
          <div>
            <h2>Yours to access</h2>
            <p>
              Use your email and password to sign in. Your account page is only
              available after authentication.
            </p>
          </div>
        </div>
        <SimulationNotice compact />
      </div>
      <AuthForm initialMode={mode === "signup" ? "signup" : "signin"} />
    </div>
  );
}
