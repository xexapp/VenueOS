import { useMemo, useState } from "react";
import type { Claim } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useSchedule } from "@/lib/schedule";
import { methodLabel, occupiesResource, payState } from "@/lib/status";
import { istDateKey, istLongDate, istTime, shiftDay } from "@/lib/time";
import { CollectDialog, rupees } from "@/components/Payment";
import { ClaimDialog } from "@/components/ClaimDialog";
import { EmptyState, ErrorState, LoadingRows, Panel } from "@/components/Panel";
import ui from "@/components/ui.module.css";
import styles from "./Revenue.module.css";

/* ============================================================
   End-of-day cash-up: for one day's sessions, what should be in the
   till, what came in by UPI/card/app, and who still owes.

   Built from the same schedule the calendar reads (live bookings
   only, so cancellations never count), bucketed by the day a session
   STARTED — the owner closes "Saturday", not "payments timestamped
   Saturday". A Saturday session paid on Sunday morning still settles
   Saturday.
   ============================================================ */

type Bucket = "cash" | "upi" | "card" | "other" | "online";

export function CashUp() {
  const { venue } = useSession();
  const today = istDateKey();
  const [date, setDate] = useState(today);
  const q = useSchedule(venue.id, date, date);
  const [collecting, setCollecting] = useState<Claim | null>(null);
  const [open, setOpen] = useState<Claim | null>(null);

  const day = useMemo(() => {
    const start = new Date(`${date}T00:00:00+05:30`).getTime();
    const end = start + 86_400_000;
    const now = Date.now();
    const claims = (q.data?.claims ?? [])
      .filter((c) => occupiesResource(c.status) && c.order_status === "CONFIRMED")
      .filter((c) => {
        const s = new Date(c.starts_at).getTime();
        return s >= start && s < end;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

    const by: Record<Bucket, number> = { cash: 0, upi: 0, card: 0, other: 0, online: 0 };
    const owed: Claim[] = [];
    const ahead: Claim[] = [];
    const unpriced: Claim[] = [];
    let expected = 0;
    for (const c of claims) {
      const amt = Number(c.amount ?? 0);
      expected += amt;
      const st = payState(c);
      if (st === "online") by.online += amt;
      else if (st === "paid") by[(c.payment_method ?? "other") as Bucket] += amt;
      else if (st === "unpaid") (new Date(c.starts_at).getTime() <= now ? owed : ahead).push(c);
      else if (c.source !== "app") unpriced.push(c);
    }
    const collected = by.cash + by.upi + by.card + by.other + by.online;
    const sum = (l: Claim[]) => l.reduce((s, c) => s + Number(c.amount ?? 0), 0);
    return { claims, by, owed, ahead, unpriced, expected, collected, owedTotal: sum(owed), aheadTotal: sum(ahead) };
  }, [q.data, date]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.dates}>
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(shiftDay(date, -1))} type="button" aria-label="Previous day">
            ‹
          </button>
          <input className={ui.input} type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(shiftDay(date, 1))} type="button" aria-label="Next day" disabled={date >= today}>
            ›
          </button>
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(today)} type="button" disabled={date === today}>
            Today
          </button>
        </div>
        <span className={styles.range}>{istLongDate(date)}</span>
        <button className={`${ui.btn} ${ui.ghost} ${ui.small} ${styles.noPrint}`} onClick={() => window.print()} type="button">
          Print
        </button>
      </div>

      {q.isPending ? (
        <Panel title="Cash-up">
          <LoadingRows rows={5} />
        </Panel>
      ) : q.isError ? (
        <Panel title="Cash-up">
          <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
        </Panel>
      ) : day.claims.length === 0 ? (
        <Panel title="Cash-up">
          <EmptyState title="No bookings this day" body="Nothing to close. Pick another day with the arrows." />
        </Panel>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.hero}>
              <div className="eyebrow" style={{ color: "var(--accent-deep)" }}>Cash in the till</div>
              <div className={`${styles.heroValue} display num`}>{rupees(day.by.cash)}</div>
              <div className={styles.split}>
                <span>Count the drawer against this figure</span>
              </div>
            </div>
            <Tile label="Collected" value={rupees(day.collected)} foot={`of ${rupees(day.expected)} booked`} />
            <Tile
              label="Still owed"
              value={rupees(day.owedTotal)}
              foot={day.owed.length ? `${day.owed.length} session${day.owed.length === 1 ? "" : "s"} unpaid` : "Nothing owed"}
              warn={day.owed.length > 0}
            />
            <Tile
              label="Bookings"
              value={String(day.claims.length)}
              foot={`${day.claims.filter((c) => c.source === "app").length} app · ${day.claims.filter((c) => c.source !== "app").length} desk${day.ahead.length ? ` · ${day.ahead.length} still ahead` : ""}`}
            />
          </div>

          <div className={styles.two}>
            <Panel title="By payment method">
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <tbody>
                    {(["cash", "upi", "card", "other", "online"] as Bucket[]).map((m) => (
                      <tr key={m}>
                        <td>{methodLabel(m)}</td>
                        <td className={`${styles.r} num`}>{rupees(day.by[m])}</td>
                      </tr>
                    ))}
                    <tr className={styles.totalRow}>
                      <td>Collected</td>
                      <td className={`${styles.r} num`}>{rupees(day.collected)}</td>
                    </tr>
                    {day.owedTotal + day.aheadTotal > 0 ? (
                      <tr>
                        <td>Not yet collected</td>
                        <td className={`${styles.r} num`}>{rupees(day.owedTotal + day.aheadTotal)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Still owed" aside={day.owed.length ? String(day.owed.length) : undefined}>
              {day.owed.length === 0 ? (
                <EmptyState title="All collected" body="Every session that has started is paid for." />
              ) : (
                <ClaimList claims={day.owed} action="Collect" onAction={setCollecting} onOpen={setOpen} />
              )}
            </Panel>
          </div>

          {day.unpriced.length ? (
            <Panel title="No amount recorded" aside={`${day.unpriced.length} desk booking${day.unpriced.length === 1 ? "" : "s"}`}>
              <ClaimList claims={day.unpriced} action="Set amount" onAction={setCollecting} onOpen={setOpen} />
            </Panel>
          ) : null}

          {day.ahead.length ? (
            <Panel title="Later today, unpaid" aside={rupees(day.aheadTotal)}>
              <ClaimList claims={day.ahead} action="Take advance" onAction={setCollecting} onOpen={setOpen} />
            </Panel>
          ) : null}
        </>
      )}

      {collecting ? <CollectDialog claim={collecting} onClose={() => setCollecting(null)} /> : null}
      {open ? <ClaimDialog claim={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ClaimList({
  claims,
  action,
  onAction,
  onOpen,
}: {
  claims: Claim[];
  action: string;
  onAction: (c: Claim) => void;
  onOpen: (c: Claim) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}>
              <td className="num">
                {istTime(c.starts_at)}–{istTime(c.expected_end_at)}
              </td>
              <td>{c.resource_label}</td>
              <td>
                <button type="button" className={styles.linkName} onClick={() => onOpen(c)}>
                  {c.customer_name || "Customer"}
                </button>
              </td>
              <td className={`${styles.r} num`}>{Number(c.amount ?? 0) > 0 ? rupees(c.amount) : "—"}</td>
              <td className={`${styles.r} ${styles.noPrint}`}>
                <button type="button" className={`${ui.btn} ${ui.primary} ${ui.small}`} onClick={() => onAction(c)}>
                  {action}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, foot, warn }: { label: string; value: string; foot: string; warn?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className="eyebrow" style={warn ? { color: "var(--accent-deep)" } : undefined}>
        {label}
      </div>
      <div className={`${styles.statValue} display num`}>{value}</div>
      <div className={styles.statFoot}>{foot}</div>
    </div>
  );
}
