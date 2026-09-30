import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Block, Claim } from "./api";
import { occupiesResource } from "./status";

/** One cache entry per (venue, range, include). Every screen reading
 *  the same day shares it, so adding a booking in the dialog updates
 *  the calendar, the dashboard and the free-station hints together. */
export function useSchedule(venueId: string, from: string, to: string, all = false) {
  return useQuery({
    queryKey: ["schedule", venueId, from, to, all],
    queryFn: () => api.schedule(venueId, from, to, all),
    // The desk leaves this open all evening; app bookings must show up
    // without a reload.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** After any booking change: the calendar/ledger AND revenue, so a booking
 *  added or cancelled at the desk moves the Revenue figures straight away
 *  rather than on its next 60s poll. */
export function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["schedule"] }),
      qc.invalidateQueries({ queryKey: ["revenue"] }),
    ]);
}

function overlaps(aStart: number, aEnd: number, bStart: string, bEnd: string) {
  return aStart < new Date(bEnd).getTime() && new Date(bStart).getTime() < aEnd;
}

/** Live claims on `resourceId` overlapping [start, end). Mirrors the
 *  no_double_book constraint, so the hint and the server agree. */
export function clashingClaims(claims: Claim[], resourceId: string, start: number, end: number) {
  return claims.filter(
    (c) =>
      c.resource_id === resourceId &&
      occupiesResource(c.status) &&
      overlaps(start, end, c.starts_at, c.expected_end_at),
  );
}

export function clashingBlocks(blocks: Block[], resourceId: string, start: number, end: number) {
  return blocks.filter(
    (b) =>
      (b.resource_id === null || b.resource_id === resourceId) &&
      overlaps(start, end, b.starts_at, b.ends_at),
  );
}
