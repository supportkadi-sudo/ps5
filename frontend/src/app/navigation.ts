import { useCallback, useEffect, useState } from "react";

type Page =
  | "cashier"
  | "shifts"
  | "catalog"
  | "reports"
  | "history"
  | "audit"
  | "settings";
export type ClubLocation = {
  page: Page;
  menu: boolean;
  account: string;
  creating: string;
  depth: number;
};
const pages: Page[] = [
  "cashier",
  "shifts",
  "catalog",
  "reports",
  "history",
  "audit",
  "settings",
];
const home: ClubLocation = {
  page: "cashier",
  menu: false,
  account: "",
  creating: "",
  depth: 0,
};
function readLocation(): ClubLocation {
  const value = window.history.state?.clubLocation;
  return value && pages.includes(value.page) && typeof value.depth === "number"
    ? { ...home, ...value }
    : home;
}
export function useClubNavigation() {
  const [location, setLocation] = useState<ClubLocation>(readLocation);
  useEffect(() => {
    if (!window.history.state?.clubLocation) {
      window.history.replaceState(
        { ...window.history.state, clubLocation: home },
        "",
      );
    }
    const pop = () => setLocation(readLocation());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = useCallback(
    (patch: Partial<ClubLocation>, replace = false) => {
      const current = readLocation();
      const next = {
        ...current,
        ...patch,
        depth: replace ? current.depth : current.depth + 1,
      };
      window.history[replace ? "replaceState" : "pushState"](
        { ...window.history.state, clubLocation: next },
        "",
      );
      setLocation(next);
    },
    [],
  );
  const back = useCallback(() => {
    if (readLocation().depth > 0) window.history.back();
    else {
      window.history.replaceState(
        { ...window.history.state, clubLocation: home },
        "",
      );
      setLocation(home);
    }
  }, []);
  return { location, navigate, back };
}
