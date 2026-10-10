"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Icon } from "@/components/icon";

export function SiteHeader({ emergencyNumber }: { emergencyNumber: string }) {
  const { data: session, isPending } = authClient.useSession();
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="Sakhi home">
          <span className="brand-mark">
            <Icon name="spark" />
          </span>
          <span>
            sakhi<span className="brand-dot">.</span>
          </span>
        </Link>
        <nav className="header-nav" aria-label="Main navigation">
          {isPending ? (
            <span
              className="nav-pending"
              role="status"
              aria-label="Checking session"
            />
          ) : (
            <Link
              className="nav-link"
              href={session ? "/dashboard" : "/auth"}
              aria-current={
                pathname === (session ? "/dashboard" : "/auth")
                  ? "page"
                  : undefined
              }
            >
              {session ? "My account" : "Sign in"}
            </Link>
          )}
          <a className="emergency-link" href={`tel:${emergencyNumber}`}>
            <Icon name="phone" />
            <span>Call {emergencyNumber}</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
