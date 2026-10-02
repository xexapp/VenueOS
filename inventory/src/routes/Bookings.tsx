import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Claim } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useSchedule } from "@/lib/schedule";
import { bookingView, occupiesResource, payLabel, payState, sourceLabel, TONE_STYLE } from "@/lib/status";
import { istDateKey, istShortDate, istTime, shiftDay, weekStart } from "@/lib/time";
import { EmptyState, ErrorState, LoadingRows, Panel } from "@/components/Panel";
import { BookingDialog } from "@/components/BookingDialog";
import { ClaimDialog, formatPhone } from "@/components/ClaimDialog";
import ui from "@/components/ui.module.css";
import styles from "./Bookings.module.css";

/* ============================================================
   The ledger: every booking in a date range, app and desk alike,
   as a list you can search. Same endpoint as the calendar with
   include=all, so cancelled and expired rows are here too — but
   hidden unless asked for, because an abandoned app checkout
   (HELD -> EXPIRED) is noise to the owner, not history.
   ============================================================ */

type Range = "today" | "week" | "next7" | "custom";
type Via = "all" | "app" | "desk";

export function Bookings() {
  const { venue } = useSession();
  const search = useSearch({ from: "/bookings" });
  const navigate = useNavigate({ from: "/bookings" });
  const today = istDateKey();

  const [range, setRange] = useState<Range>("week");
  const [custom, setCustom] = useState({ from: today, to: shiftDay(today, 6) });
  const [via, setVia] = useState<Via>("all");
  const [showDead, setShowDead] = useState(false);
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [open, setOpen] = useState<Claim | null>(null);
  const [adding, setAdding] = useState(false);
  const text = search.q ?? "";

  const [from, to] = useMemo((): [string, string] => {
    switch (range) {
      case "today":
        return [today, today];
      case "week": {
        const w = weekStart(today);
        return [w, shiftDay(w, 6)];
      }
      case "next7":
        return [today, shiftDay(today, 6)];
      case "custom":
        return custom.to < custom.from ? [custom.from, custom.from] : [custom.from, custom.to];
    }
  }, [range, custom, today]);

  const q = useSchedule(venue.id, from, to, true);

  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return (q.data?.claims ?? [])
      .filter((c) => showDead || occupiesResource(c.status))
      .filter((c) => via === "all" || (via === "app" ? c.source === "app" : c.source !== "app"))
      .filter((c) => !unpaidOnly || (payState(c) === "unpaid" && occupiesResource(c.status)))
      .filter(
        (c) =>
          !needle ||
          c.customer_name.toLowerCase().includes(needle) ||
          c.resource_label.toLowerCase().includes(needle) ||
          (c.source_detail ?? "").toLowerCase().includes(needle) ||
          (digits.length >= 3 && c.customer_phone.includes(digits)),
      );
  }, [q.data, text, via, showDead, unpaidOnly]);

  const totals = useMemo(() => {
    const live = rows.filter((c) => occupiesResource(c.status));
    return {
      count: live.length,
      app: live.filter((c) => c.source === "app").length,
      desk: live.filter((c) => c.source !== "app").length,
      amount: live.reduce((s, c) => s + (c.amount ? Number(c.amount) : 0), 0),
    };
  }, [rows]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={ui.segments}>
          {(
            [
              ["today", "Today"],
              ["week", "This week"],
              ["next7", "Next 7 days"],
              ["custom", "Dates…"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={ui.segment} aria-pressed={range === k} onClick={() => setRange(k)}>
              {label}
            </button>
          ))}
        </div>
        {range === "custom" ? (
          <div className={styles.dates}>
            <input className={ui.input} type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
            <span>to</span>
            <input className={ui.input} type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
          </div>
        ) : null}
        <button className={`${ui.btn} ${ui.primary} ${styles.add}`} onClick={() => setAdding(true)} type="button">
          + New booking
        </button>
      </div>

      <div className={styles.filters}>
        <input
          className={`${ui.input} ${styles.search}`}
          value={text}
          onChange={(e) => navigate({ search: { q: e.target.value || undefined }, replace: true })}
          placeholder="Search name, phone or station"
          aria-label="Search bookings"
        />
        <div className={ui.segments}>
          {(
            [
              ["all", "All"],
              ["app", "XEX app"],
              ["desk", "Phone / walk-in"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={ui.segment} aria-pressed={via === k} onClick={() => setVia(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} />
          Unpaid only
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} />
          Show cancelled &amp; expired
        </label>
      </div>

      <Panel
        title={`${totals.count} booking${totals.count === 1 ? "" : "s"}`}
        aside={
          q.data
            ? `${totals.app} app · ${totals.desk} desk${totals.amount ? ` · ₹${Math.round(totals.amount).toLocaleString("en-IN")} recorded` : ""}`
            : undefined
        }
      >
        {q.isPending ? (
          <LoadingRows rows={6} />
        ) : q.isError ? (
          <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={text ? "No matches" : "No bookings"}
            body={text ? "Nothing in this range matches that search." : "Nothing is booked in this range yet."}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Station</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Via</th>
                  <th>Status</th>
                  <th className={styles.right}>Amount</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const view = bookingView(c);
                  const tone = TONE_STYLE[view.tone];
                  return (
                    <tr key={c.id} onClick={() => setOpen(c)} data-dead={!occupiesResource(c.status)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(c)}>
                      <td className="num">
                        <span className={styles.day}>{istShortDate(istDateKey(new Date(c.starts_at)))}</span>
                        {istTime(c.starts_at)}–{istTime(c.expected_end_at)}
                      </td>
                      <td>{c.resource_label}</td>
                      <td className={styles.name}>{c.customer_name || "—"}</td>
                      <td className="num">{c.customer_phone ? formatPhone(c.customer_phone) : "—"}</td>
                      <td>
                        {sourceLabel(c.source)}
                        {c.source_detail ? <span className={styles.detail}> · {c.source_detail}</span> : null}
                      </td>
                      <td>
                        <span className={ui.chip} style={{ color: tone.color, background: tone.background }}>
                          {view.label}
                        </span>
                      </td>
                      <td className={`${styles.right} num`}>
                        {c.amount && Number(c.amount) > 0 ? `₹${Math.round(Number(c.amount)).toLocaleString("en-IN")}` : "—"}
                      </td>
                      <td className={styles.pay} data-state={occupiesResource(c.status) ? payState(c) : "free"}>
                        {occupiesResource(c.status) ? payLabel(c) || "—" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Phones: one card per booking instead of an 8-column table.
            Same rows, same tap-to-open; CSS shows one or the other. */}
        {!q.isPending && !q.isError && rows.length ? (
          <ul className={styles.cards}>
            {rows.map((c) => {
              const view = bookingView(c);
              const tone = TONE_STYLE[view.tone];
              const pay = occupiesResource(c.status) ? payLabel(c) : "";
              return (
                <li key={c.id}>
                  <button type="button" className={styles.card} data-dead={!occupiesResource(c.status)} onClick={() => setOpen(c)}>
                    <span className={styles.cardTop}>
                      <span className="num">
                        <span className={styles.day}>{istShortDate(istDateKey(new Date(c.starts_at)))}</span>
                        {istTime(c.starts_at)}–{istTime(c.expected_end_at)}
                      </span>
                      <span className={ui.chip} style={{ color: tone.color, background: tone.background }}>
                        {view.label}
                      </span>
                    </span>
                    <span className={styles.cardWho}>
                      <b>{c.customer_name || "Customer"}</b> · {c.resource_label}
                    </span>
                    <span className={styles.cardMeta}>
                      {sourceLabel(c.source)}
                      {c.amount && Number(c.amount) > 0 ? <span className="num"> · ₹{Math.round(Number(c.amount)).toLocaleString("en-IN")}</span> : null}
                      {pay ? (
                        <span className={styles.pay} data-state={payState(c)}>
                          {" "}
                          · {pay}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Panel>

      {open ? <ClaimDialog claim={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <BookingDialog draft={{ dateKey: today }} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
