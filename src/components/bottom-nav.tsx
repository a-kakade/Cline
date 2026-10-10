"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Icon } from "@/components/icon";

const tabs = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/rooms", label: "Community", icon: "chat" },
  { href: "/journeys", label: "Trip", icon: "route" },
  { href: "/map", label: "Map", icon: "map" },
] as const;
// SOS sits in the middle of the bar. It opens the SOS control (with its location
// choice) instead of sending at once, so a stray tap can’t raise an alert.
const SOS_AT = 2;

// Mobile-only primary navigation. Every destination requires an account, so
// the bar only appears for signed-in people.
export function BottomNav() {
  const { data: session } = authClient.useSession();
  const pathname = usePathname() ?? "";

  if (!session) return null;

  return (
    <>
      <div className="bottom-nav-spacer" aria-hidden="true" />
      <nav className="bottom-nav" aria-label="Primary">
        {tabs.flatMap((tab, i) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const link = (
            <Link
              key={tab.href}
              href={tab.href}
              className="bottom-tab"
              aria-current={active ? "page" : undefined}
            >
              <span className="bottom-tab-icon">
                <Icon name={tab.icon} width={22} height={22} />
              </span>
              <span className="bottom-tab-label">{tab.label}</span>
            </Link>
          );
          return i === SOS_AT
            ? [
                <Link
                  key="sos"
                  href="/dashboard#sos"
                  className="bottom-sos"
                  aria-label="SOS: open the emergency alert"
                >
                  <span className="bottom-sos-disc">
                    <Icon name="siren" width={28} height={28} />
                  </span>
                  SOS
                </Link>,
                link,
              ]
            : [link];
        })}
      </nav>
    </>
  );
}
