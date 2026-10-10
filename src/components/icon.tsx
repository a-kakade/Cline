import type { SVGProps } from "react";

type IconName =
  | "arrow"
  | "chat"
  | "check"
  | "home"
  | "lock"
  | "map"
  | "phone"
  | "route"
  | "shield"
  | "siren"
  | "walk"
  | "car"
  | "bus"
  | "person"
  | "people"
  | "swap"
  | "clock"
  | "heart"
  | "search"
  | "edit"
  | "share"
  | "chevron"
  | "filter"
  | "star"
  | "locate"
  | "hospital"
  | "train"
  | "spark";

const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  chat: (
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5v-8Z" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  home: (
    <>
      <path d="m3 11 9-8 9 8v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V11Z" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  phone: (
    <path d="m7 3 3 5-3 2a16 16 0 0 0 7 7l2-3 5 3-1 3c-.4 1-1.5 1.3-2.5 1C9.5 19 5 14.5 3 6.5c-.3-1 .1-2.1 1-2.5l3-1Z" />
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9.5 21 2.3-6-2.6-2.6 1-4.4 3.3 2.2 2.5.9M8 11l-2.5 2.5" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 16v-4l1.8-5h11.4l1.8 5v4M3 16h18v3H3z" />
      <path d="M6.5 12h11M7 19v1.5M17 19v1.5" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="3" width="14" height="15" rx="3" />
      <path d="M5 11h14M9 21v-3m6 3v-3M8.5 14.5h.01M15.5 14.5h.01" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3 20a6 6 0 0 1 12 0M15.5 14.5A5 5 0 0 1 21 19.5" />
    </>
  ),
  swap: <path d="M8 4v16m0 0-3-3m3 3 3-3M16 20V4m0 0-3 3m3-3 3 3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  heart: (
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="18" cy="18" r="2.3" />
      <path d="m8 11 8-4M8 13l8 4" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  siren: (
    <>
      <path d="M7 18v-5a5 5 0 0 1 10 0v5" />
      <path d="M4 18h16v3H4zM12 3v2M4.5 7l1.5 1.2M19.5 7 18 8.2" />
    </>
  ),
  star: (
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.8 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8L12 3Z" />
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  hospital: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14M9 21l2-4m4 4-2-4M9 14h.01M15 14h.01" />
    </>
  ),
  spark: (
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
  ),
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
