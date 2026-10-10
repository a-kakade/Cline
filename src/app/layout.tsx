import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sakhi — A calmer place to start", template: "%s · Sakhi" },
  description:
    "Your trusted contacts, an explicit SOS action, and clear alert outcomes. Sakhi is not an emergency response service.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const configuredNumber = process.env.EMERGENCY_NUMBER?.trim();
  const emergencyNumber =
    configuredNumber && /^\+?\d{1,15}$/.test(configuredNumber)
      ? configuredNumber
      : "112";

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader emergencyNumber={emergencyNumber} />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
