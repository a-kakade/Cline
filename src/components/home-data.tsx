"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiRequest } from "@/lib/api-client";
import type { Alert } from "@/lib/emergency-types";
import type { Contact } from "@/lib/schemas";

export type Loadable<T> =
  { state: "loading" } | { state: "error" } | { state: "ready"; data: T };
type HomeData = { contacts: Loadable<Contact[]>; alerts: Loadable<Alert[]> };

const pending: HomeData = {
  contacts: { state: "loading" },
  alerts: { state: "loading" },
};
const HomeDataContext = createContext<HomeData>(pending);

export function useHomeData() {
  return useContext(HomeDataContext);
}

function settle<T>(request: Promise<T>): Promise<Loadable<T>> {
  return request.then(
    (data): Loadable<T> => ({ state: "ready", data }),
    (): Loadable<T> => ({ state: "error" }),
  );
}

// Loads the home page's account data once so every section can share it. A
// failure in one request never hides the other, and no section ever shows a
// made-up value: it shows "loading" or "unavailable" instead.
export function HomeDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HomeData>(pending);

  useEffect(() => {
    let active = true;
    Promise.all([
      settle(apiRequest<Contact[]>("/api/contacts")),
      settle(apiRequest<Alert[]>("/api/sos")),
    ]).then(([contacts, alerts]) => {
      if (active) setData({ contacts, alerts });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <HomeDataContext.Provider value={data}>{children}</HomeDataContext.Provider>
  );
}
