"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(
          "We couldn’t sign you out. Please try again before leaving this device.",
        );
        return;
      }
      router.replace("/auth");
      router.refresh();
    } catch {
      setError(
        "We couldn’t reach the sign-in service. Please try signing out again.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="sign-out-control">
      <button
        className="button button-secondary"
        type="button"
        disabled={pending}
        onClick={signOut}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      <span className="sr-only" role="status">
        {pending ? "Signing out of your account." : ""}
      </span>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
