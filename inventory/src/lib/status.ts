import type { Claim, ClaimStatus, OrderStatus, PaymentMethod, Source } from "./api";

/* ============================================================
   The mockup shipped four statuses. The backend emits ten order
   states and four claim states. This module is the single place
   that translation happens — exhaustive switches so a new server
   state fails the typecheck instead of silently rendering grey.

   Rosewood carries status by weight and fill, never by a second
   hue, so every tone below is a value of the same pink or a neutral.
   ============================================================ */

export type Tone = "neutral" | "quiet" | "attention" | "gone";

export interface StatusView {
  label: string;
  tone: Tone;
}

export const TONE_STYLE: Record<Tone, { color: string; background: string }> = {
  // confirmed and unremarkable — the common case should be quiet
  neutral: { color: "var(--text-2)", background: "var(--track)" },
  // holds and drafts: present but not yet real
  quiet: { color: "var(--muted-2)", background: "var(--border-soft)" },
  // the operator has to do something
  attention: { color: "var(--accent-deep)", background: "var(--accent-wash)" },
  // dead rows: struck from the day
  gone: { color: "var(--faint)", background: "transparent" },
};

export function orderStatusView(s: OrderStatus): StatusView {
  switch (s) {
    case "CONFIRMED":
      return { label: "Confirmed", tone: "neutral" };
    case "PENDING_APPROVAL":
      return { label: "Needs approval", tone: "attention" };
    case "WAITLISTED":
      return { label: "Waitlist", tone: "attention" };
    case "HELD":
      return { label: "Holding", tone: "quiet" };
    case "AWAITING_PAYMENT":
      return { label: "Awaiting payment", tone: "quiet" };
    case "DRAFT":
      return { label: "Draft", tone: "quiet" };
    case "REJECTED":
      return { label: "Declined", tone: "gone" };
    case "EXPIRED":
      return { label: "Expired", tone: "gone" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "gone" };
    case "FAILED":
      return { label: "Failed", tone: "gone" };
  }
}

/** The label for a booking row. While the claim holds the station, the
 *  ORDER says what is going on (needs approval, awaiting payment); once
 *  it is dead, the claim says how it ended. */
export function bookingView(c: Claim): StatusView {
  return occupiesResource(c.status) ? orderStatusView(c.order_status) : claimStatusView(c.status);
}

export function claimStatusView(s: ClaimStatus): StatusView {
  switch (s) {
    case "CONFIRMED":
      return { label: "Confirmed", tone: "neutral" };
    case "HELD":
      return { label: "Holding", tone: "quiet" };
    case "EXPIRED":
      return { label: "Expired", tone: "gone" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "gone" };
  }
}

/** Claims that still occupy their resource. Mirrors the exclusion
 *  constraint's WHERE clause, so the UI and the DB agree on what
 *  "booked" means. */
export function occupiesResource(s: ClaimStatus): boolean {
  return s === "HELD" || s === "CONFIRMED";
}

export function sourceLabel(s: Source): string {
  switch (s) {
    case "app":
      return "XeX app";
    case "phone":
      return "Phone call";
    case "walk_in":
      return "Walk-in";
    case "other_platform":
      return "Other platform";
  }
}

/** Is this booking over? A released session is over at release. */
export function isFinished(c: Claim, now = Date.now()): boolean {
  return new Date(c.expected_end_at).getTime() <= now;
}

/** Is someone on this station right now? */
export function isRunning(c: Claim, now = Date.now()): boolean {
  return (
    occupiesResource(c.status) &&
    new Date(c.starts_at).getTime() <= now &&
    new Date(c.expected_end_at).getTime() > now
  );
}

export type PayState = "online" | "paid" | "unpaid" | "free";

/** Money on one booking, in the four states the desk cares about:
 *  paid online (app), paid at the desk, still owed, or nothing to collect
 *  (a free booking, or a desk booking saved without an amount). */
export function payState(c: Claim): PayState {
  const amount = Number(c.amount ?? 0);
  if (c.source === "app") return c.is_paid && amount > 0 ? "online" : "free";
  if (c.paid_at) return "paid";
  return amount > 0 ? "unpaid" : "free";
}

export function methodLabel(m: PaymentMethod | "online"): string {
  switch (m) {
    case "online":
      return "Online (app)";
    case "cash":
      return "Cash";
    case "upi":
      return "UPI";
    case "card":
      return "Card";
    case "other":
      return "Other";
  }
}

/** "Paid · UPI", "Unpaid", "Paid online", or "" when there is nothing to say. */
export function payLabel(c: Claim): string {
  switch (payState(c)) {
    case "online":
      return "Paid online";
    case "paid":
      return `Paid · ${methodLabel(c.payment_method ?? "other")}`;
    case "unpaid":
      return "Unpaid";
    case "free":
      return "";
  }
}

/** Owed for a session that has already started — the desk should collect. */
export function owedNow(c: Claim, now = Date.now()): boolean {
  return payState(c) === "unpaid" && occupiesResource(c.status) && new Date(c.starts_at).getTime() <= now;
}
