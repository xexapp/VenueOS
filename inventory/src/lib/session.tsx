import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getAuthToken, onAuthChange, setAuthToken } from "./api";
import type { Me, Venue } from "./api";

/* ============================================================
   Who is at the desk, and which venue they are running.

   The pilot is one owner, one venue, so the first VENUE listing
   the account owns is the venue. A switcher can come later; the
   API already returns every venue the caller owns.
   ============================================================ */

export function useAuthToken() {
  const [token, setToken] = useState(getAuthToken);
  const qc = useQueryClient();
  useEffect(
    () =>
      onAuthChange((t) => {
        setToken(t);
        // Never let one account's cached bookings survive into another's.
        if (!t) qc.clear();
      }),
    [qc],
  );
  return token;
}

export function signOut() {
  setAuthToken(null);
}

interface SessionValue {
  me: Me | undefined;
  venue: Venue;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

export function useVenuesQuery() {
  return useQuery({
    queryKey: ["venues"],
    queryFn: api.venues,
    staleTime: 5 * 60_000,
  });
}

export function useMeQuery() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 10 * 60_000 });
}

export function SessionProvider({
  venue,
  me,
  children,
}: {
  venue: Venue;
  me: Me | undefined;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={{ venue, me }}>{children}</SessionContext.Provider>;
}

/** Stations in display order: PCs first, then consoles, each by
 *  metadata.position — the order the seed (and later the seat map) sets. */
export function orderedStations(venue: Venue) {
  return [...venue.resources]
    .filter((r) => r.is_active)
    .sort((a, b) => (a.metadata.position ?? 999) - (b.metadata.position ?? 999) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Group label for a station kind. Unknown kinds fall back to the raw
 *  kind so a new resource type still renders, just less prettily. */
export function zoneLabel(kind: string) {
  switch (kind) {
    case "pc":
      return "Gaming PCs";
    case "console":
      return "PlayStation";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}
