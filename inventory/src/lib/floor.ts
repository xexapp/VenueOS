import type { Block, Claim, Resource } from "./api";
import { occupiesResource } from "./status";

/* ============================================================
   What each station is doing RIGHT NOW — the Floor view's model.

   One pure function over the same schedule the calendar reads, so
   the Floor, the calendar and the dashboard can never disagree
   about whether PC 3 is free. Precedence, first match wins:

     blocked   an active block covers now (broken PC, private event)
     playing   a CONFIRMED claim covers now
     pending   a HELD claim covers now (app checkout / awaiting approval)
     overtime  a session ended in the last OVERTIME_MIN minutes and was
               never marked done — the player is probably still there
     free      nothing on it; "free until" the next booking or block

   "Overtime" is the one state the database can't know: a session
   that ended on paper, with the kid still in the chair. It's shown
   so the desk can extend or close it, and it clears itself once
   marked done (released) or after OVERTIME_MIN.
   ============================================================ */

export const ENDING_SOON_MIN = 10;
export const OVERTIME_MIN = 15;

export type StationState =
  | { kind: "blocked"; block: Block; freeAt: number | null }
  | { kind: "playing"; claim: Claim; minsLeft: number; progress: number; endingSoon: boolean; next: Upcoming | null }
  | { kind: "pending"; claim: Claim; next: Upcoming | null }
  | { kind: "overtime"; claim: Claim; minsOver: number; next: Upcoming | null }
  | { kind: "free"; next: Upcoming | null };

/** The next thing that will occupy the station, if any. */
export interface Upcoming {
  at: number; // epoch ms
  label: string; // customer name, or the block's reason
  claim?: Claim;
  block?: Block;
}

const ms = (iso: string) => new Date(iso).getTime();

export function stationState(station: Resource, claims: Claim[], blocks: Block[], now: number): StationState {
  const mine = claims.filter((c) => c.resource_id === station.id);
  const myBlocks = blocks.filter((b) => b.resource_id === null || b.resource_id === station.id);

  const next = nextUp(mine, myBlocks, now);

  const block = myBlocks.find((b) => ms(b.starts_at) <= now && ms(b.ends_at) > now);
  if (block) return { kind: "blocked", block, freeAt: ms(block.ends_at) };

  const live = mine.find(
    (c) => occupiesResource(c.status) && ms(c.starts_at) <= now && ms(c.expected_end_at) > now,
  );
  if (live && live.status === "CONFIRMED") {
    const start = ms(live.starts_at);
    const end = ms(live.expected_end_at);
    const minsLeft = Math.max(0, Math.ceil((end - now) / 60_000));
    return {
      kind: "playing",
      claim: live,
      minsLeft,
      progress: Math.min(1, Math.max(0, (now - start) / (end - start))),
      endingSoon: minsLeft <= ENDING_SOON_MIN,
      next,
    };
  }
  if (live) return { kind: "pending", claim: live, next };

  // Most recent session that ended in the overtime window and wasn't closed.
  const justEnded = mine
    .filter(
      (c) =>
        c.status === "CONFIRMED" &&
        c.order_status === "CONFIRMED" &&
        !c.released_at &&
        ms(c.expected_end_at) <= now &&
        now - ms(c.expected_end_at) < OVERTIME_MIN * 60_000,
    )
    .sort((a, b) => ms(b.expected_end_at) - ms(a.expected_end_at))[0];
  if (justEnded) {
    return { kind: "overtime", claim: justEnded, minsOver: Math.floor((now - ms(justEnded.expected_end_at)) / 60_000), next };
  }

  return { kind: "free", next };
}

function nextUp(claims: Claim[], blocks: Block[], now: number): Upcoming | null {
  const c = claims
    .filter((x) => occupiesResource(x.status) && ms(x.starts_at) > now)
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))[0];
  const b = blocks.filter((x) => ms(x.starts_at) > now).sort((p, q) => ms(p.starts_at) - ms(q.starts_at))[0];
  const cu: Upcoming | null = c ? { at: ms(c.starts_at), label: c.customer_name || "Customer", claim: c } : null;
  const bu: Upcoming | null = b ? { at: ms(b.starts_at), label: b.reason || "Blocked", block: b } : null;
  if (cu && bu) return cu.at <= bu.at ? cu : bu;
  return cu ?? bu;
}

/** Minutes a walk-in can have before the station's next booking or block. */
export function minutesUntil(next: Upcoming | null, now: number): number | null {
  return next ? Math.floor((next.at - now) / 60_000) : null;
}
