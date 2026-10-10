import Link from "next/link";
import styles from "./home.module.css";

// The bell lives here rather than in the shared icon set so the home page can
// be changed without touching files that other pages depend on.
function BellIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function HomeAlertLink() {
  return (
    <Link href="/alerts" className={styles.bell} aria-label="Alerts">
      <BellIcon />
    </Link>
  );
}
