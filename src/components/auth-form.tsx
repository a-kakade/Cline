"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Icon } from "@/components/icon";

export function AuthForm({
  initialMode = "signin",
}: {
  initialMode?: "signin" | "signup";
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const isSignUp = mode === "signup";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function changeMode(next: "signin" | "signup") {
    if (inFlight.current) return;
    setMode(next);
    setError("");
    setShowPassword(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (isSignUp && !name) {
      setError("Please enter your name.");
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError("");

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(
          isSignUp
            ? "We couldn’t create your account. Check your details, or try signing in if you already have an account."
            : "We couldn’t sign you in. Check your email and password, then try again.",
        );
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(
        "We couldn’t reach the sign-in service. Check your connection and try again.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <div
        className="auth-mode-switch"
        role="group"
        aria-label="Account access"
      >
        <button
          type="button"
          aria-pressed={!isSignUp}
          onClick={() => changeMode("signin")}
          disabled={pending}
        >
          Sign in
        </button>
        <button
          type="button"
          aria-pressed={isSignUp}
          onClick={() => changeMode("signup")}
          disabled={pending}
        >
          Create account
        </button>
      </div>
      <h2>{isSignUp ? "Make yourself at home." : "Good to see you again."}</h2>
      <p className="auth-intro">
        {isSignUp
          ? "Just a few details to get started."
          : "Sign in to your Sakhi account."}
      </p>
      <form
        key={mode}
        onSubmit={handleSubmit}
        aria-label={
          isSignUp ? "Create your account" : "Sign in to your account"
        }
        aria-busy={pending}
      >
        {error && (
          <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>
            {error}
          </div>
        )}
        <fieldset disabled={pending}>
          <legend className="sr-only">
            {isSignUp ? "Your account details" : "Your sign-in details"}
          </legend>
          {isSignUp && (
            <div className="field">
              <label htmlFor="auth-name">Your name</label>
              <input
                id="auth-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                maxLength={100}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={254}
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <div className="password-field">
              <input
                id="auth-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={isSignUp ? 12 : undefined}
                maxLength={128}
                aria-describedby={isSignUp ? "password-hint" : undefined}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-controls="auth-password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {isSignUp && (
              <p id="password-hint" className="field-hint">
                Use 12–128 characters. Choose a password you don’t use
                elsewhere.
              </p>
            )}
          </div>
          <button className="button button-primary button-full" type="submit">
            {pending
              ? isSignUp
                ? "Creating your account…"
                : "Signing in…"
              : isSignUp
                ? "Create your account"
                : "Sign in"}{" "}
            {!pending && <Icon name="arrow" />}
          </button>
        </fieldset>
        <div className="sr-only" role="status" aria-live="polite">
          {pending ? "Please wait. Your request is being processed." : ""}
        </div>
      </form>
      <p className="auth-security">
        <Icon name="lock" /> On a shared device? Remember to sign out.
      </p>
    </div>
  );
}
