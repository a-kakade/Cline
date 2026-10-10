"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container state-page">
      <span className="icon-tile">
        <Icon name="shield" />
      </span>
      <p className="eyebrow">LET’S TRY THAT AGAIN</p>
      <h1>We couldn’t load this page.</h1>
      <p role="alert">
        Something went wrong. Your account information isn’t available on this
        page right now.
      </p>
      <div className="state-actions">
        <button className="button button-primary" onClick={reset} type="button">
          Try again <Icon name="arrow" />
        </button>
        <Link className="button button-secondary" href="/">
          Go home
        </Link>
      </div>
      <p className="quiet-note">
        Need urgent help? The emergency call link is still at the top of the
        page.
      </p>
    </div>
  );
}
