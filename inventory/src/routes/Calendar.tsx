import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Block, Claim, Day, Resource } from "@/lib/api";
import { orderedStations, useSession, zoneLabel } from "@/lib/session";
import { useSchedule } from "@/lib/schedule";
import { isFinished, isRunning, occupiesResource, sourceLabel } from "@/lib/status";
import { hhmm, hoursIntoDay, istDateKey, istLongDate, istTime, shiftDay, weekStart } from "@/lib/time";
import { BookingDialog } from "@/components/BookingDialog";
import type { BookingDraft } from "@/components/BookingDialog";
import { BlockDialog } from "@/components/BlockDialog";
import { BlockInfoDialog, ClaimDialog } from "@/components/ClaimDialog";
import { ErrorState } from "@/components/Panel";
import ui from "@/components/ui.module.css";
import styles from "./Calendar.module.css";

/* ============================================================
   The calendar: every station down the side, the trading day
   across the top. Built for the front desk answering "is anything
   free at 7?" in one glance, and "book it" in one click.

   - One fetch per WEEK feeds both the week strip and the day grid,
     so moving between days in the same week is instant.
   - Click empty space on a station's row: a new booking opens
     prefilled with that station and the time under the cursor,
     snapped to 15 minutes.
   - App bookings and desk bookings are told apart by fill, pending
     app requests by an outline. Blocks are hatched.
   ============================================================ */

const HOUR_PX = 104;
const SNAP_MIN = 15;
const FALLBACK = { open: 10, close: 23 };

type Dialog =
  | { kind: "new"; draft: BookingDraft }
  | { kind: "claim"; claim: Claim }
  | { kind: "block"; block: Block }
  | { kind: "newBlock"; resourceId?: string; start?: string }
  | null;

export function Calendar() {
  const { venue } = useSession();
  const search = useSearch({ from: "/calendar" });
  const navigate = useNavigate({ from: "/calendar" });
  const today = istDateKey();
  const date = search.date ?? today;
  const setDate = (d: string) => navigate({ search: { date: d === today ? undefined : d } });

  const week = weekStart(date);
  const weekEnd = shiftDay(week, 6);
  const q = useSchedule(venue.id, week, weekEnd);
  const [dialog, setDialog] = useState<Dialog>(null);

  const stations = useMemo(() => orderedStations(venue), [venue]);
  const dayInfo = q.data?.days.find((d) => d.date === date);
  const dayStart = new Date(`${date}T00:00:00+05:30`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const claims = useMemo(
    () =>
      (q.data?.claims ?? []).filter(
        (c) =>
          occupiesResource(c.status) &&
          new Date(c.starts_at).getTime() < dayEnd &&
          new Date(c.expected_end_at).getTime() > dayStart,
      ),
    [q.data, dayStart, dayEnd],
  );
  const blocks = useMemo(
    () =>
      (q.data?.blocks ?? []).filter(
        (b) => new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart,
      ),
    [q.data, dayStart, dayEnd],
  );

  const axis = useMemo(() => axisFor(date, dayInfo, claims), [date, dayInfo, claims]);

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(shiftDay(date, -1))} type="button" aria-label="Previous day">
            ‹
          </button>
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(today)} type="button" disabled={date === today}>
            Today
          </button>
          <button className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setDate(shiftDay(date, 1))} type="button" aria-label="Next day">
            ›
          </button>
          <input
            className={`${ui.input} ${styles.datePick}`}
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Pick a date"
          />
        </div>
        <h1 className={`${styles.title} display`}>{istLongDate(date)}</h1>
        <div className={styles.actions}>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={() => setDialog({ kind: "newBlock" })} type="button">
            Block time
          </button>
          <button className={`${ui.btn} ${ui.primary}`} onClick={() => setDialog({ kind: "new", draft: { dateKey: date } })} type="button">
            + New booking
          </button>
        </div>
      </div>

      <WeekStrip
        week={week}
        selected={date}
        today={today}
        days={q.data?.days}
        claims={q.data?.claims}
        stations={stations.length}
        onPick={setDate}
      />

      {date === today && q.data ? <FreeNow stations={stations} claims={claims} blocks={blocks} /> : null}

      {q.isError ? (
        <div className={styles.panel}>
          <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
        </div>
      ) : (
        <div className={styles.panel} aria-busy={q.isPending}>
          {dayInfo && !dayInfo.opens_at ? (
            <p className={styles.closed}>No opening hours set for this day. You can still add bookings.</p>
          ) : null}
          <Grid
            date={date}
            isToday={date === today}
            axis={axis}
            stations={stations}
            claims={claims}
            blocks={blocks}
            loading={q.isPending}
            onEmpty={(resourceId, start) => setDialog({ kind: "new", draft: { dateKey: date, resourceId, start } })}
            onClaim={(claim) => setDialog({ kind: "claim", claim })}
            onBlock={(block) => setDialog({ kind: "block", block })}
          />
          <Legend />
        </div>
      )}

      {dialog?.kind === "new" ? <BookingDialog draft={dialog.draft} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "claim" ? <ClaimDialog claim={dialog.claim} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "block" ? <BlockInfoDialog block={dialog.block} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "newBlock" ? (
        <BlockDialog dateKey={date} resourceId={dialog.resourceId} start={dialog.start} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- week */

function WeekStrip({
  week,
  selected,
  today,
  days,
  claims,
  stations,
  onPick,
}: {
  week: string;
  selected: string;
  today: string;
  days: Day[] | undefined;
  claims: Claim[] | undefined;
  stations: number;
  onPick: (d: string) => void;
}) {
  const keys = Array.from({ length: 7 }, (_, i) => shiftDay(week, i));
  return (
    <div className={styles.week} role="tablist" aria-label="Week">
      {keys.map((k) => {
        const start = new Date(`${k}T00:00:00+05:30`).getTime();
        const n = claims?.filter(
          (c) => occupiesResource(c.status) && new Date(c.starts_at).getTime() >= start && new Date(c.starts_at).getTime() < start + 86_400_000,
        ).length;
        const d = days?.find((x) => x.date === k);
        // Booked hours over open station-hours: a rough "how full" bar.
        const fill = d && claims ? fullness(d, claims, stations) : 0;
        const [wd, dm] = shortParts(k);
        return (
          <button
            key={k}
            role="tab"
            aria-selected={k === selected}
            className={styles.weekDay}
            data-today={k === today}
            onClick={() => onPick(k)}
            type="button"
          >
            <span className={styles.wd}>{wd}</span>
            <span className={`${styles.dm} display`}>{dm}</span>
            <span className={styles.count}>{n === undefined ? " " : n === 0 ? "No bookings" : `${n} booking${n === 1 ? "" : "s"}`}</span>
            <span className={styles.fill}>
              <span style={{ width: `${Math.min(fill, 1) * 100}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function fullness(d: Day, claims: Claim[], stations: number) {
  if (!d.opens_at || !d.closes_at || !stations) return 0;
  const open = new Date(d.opens_at).getTime();
  const close = new Date(d.closes_at).getTime();
  let booked = 0;
  for (const c of claims) {
    if (!occupiesResource(c.status)) continue;
    const s = Math.max(new Date(c.starts_at).getTime(), open);
    const e = Math.min(new Date(c.expected_end_at).getTime(), close);
    if (e > s) booked += e - s;
  }
  return booked / ((close - open) * stations);
}

function shortParts(key: string): [string, string] {
  const d = new Date(`${key}T12:00:00+05:30`);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(d);
  return [wd, dm];
}

/* ---------------------------------------------------------------- free now */

function FreeNow({ stations, claims, blocks }: { stations: Resource[]; claims: Claim[]; blocks: Block[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const busy = (s: Resource) =>
    claims.find((c) => c.resource_id === s.id && isRunning(c, now)) ??
    blocks.find(
      (b) => (b.resource_id === null || b.resource_id === s.id) && new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() > now,
    );

  const groups = new Map<string, Resource[]>();
  for (const s of stations) groups.set(s.kind, [...(groups.get(s.kind) ?? []), s]);

  return (
    <div className={styles.freeNow}>
      <span className={`${styles.freeTitle} eyebrow`}>Right now</span>
      {[...groups.entries()].map(([kind, list]) => {
        const free = list.filter((s) => !busy(s)).length;
        return (
          <div className={styles.freeGroup} key={kind}>
            <span className={styles.freeCount}>
              <b className="num">{free}</b> of {list.length} {zoneLabel(kind)} free
            </span>
            <span className={styles.dots}>
              {list.map((s) => {
                const b = busy(s);
                const until = b ? ("expected_end_at" in b ? b.expected_end_at : b.ends_at) : null;
                return (
                  <span
                    key={s.id}
                    className={styles.stationDot}
                    data-busy={!!b}
                    title={b ? `${s.label} busy until ${istTime(until!)}` : `${s.label} free`}
                  >
                    {s.label.replace(/^\D+\s*/, "") || s.label}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- grid */

interface Axis {
  start: number; // hours into the day
  end: number;
}

function axisFor(date: string, day: Day | undefined, claims: Claim[]): Axis {
  let start = day?.opens_at ? Math.floor(hoursIntoDay(date, day.opens_at)) : FALLBACK.open;
  let end = day?.closes_at ? Math.ceil(hoursIntoDay(date, day.closes_at)) : FALLBACK.close;
  // Stretch to show anything booked outside the hours — the hours are a
  // guide, and a booking the axis hides is a booking the desk forgets.
  for (const c of claims) {
    start = Math.min(start, Math.max(0, Math.floor(hoursIntoDay(date, c.starts_at))));
    end = Math.max(end, Math.min(30, Math.ceil(hoursIntoDay(date, c.expected_end_at))));
  }
  return { start, end: Math.max(end, start + 1) };
}

function Grid({
  date,
  isToday,
  axis,
  stations,
  claims,
  blocks,
  loading,
  onEmpty,
  onClaim,
  onBlock,
}: {
  date: string;
  isToday: boolean;
  axis: Axis;
  stations: Resource[];
  claims: Claim[];
  blocks: Block[];
  loading: boolean;
  onEmpty: (resourceId: string, start: string) => void;
  onClaim: (c: Claim) => void;
  onBlock: (b: Block) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const width = (axis.end - axis.start) * HOUR_PX;
  const x = (iso: string) => (hoursIntoDay(date, iso) - axis.start) * HOUR_PX;
  const [hover, setHover] = useState<{ id: string; h: number } | null>(null);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowX = isToday ? x(new Date(now).toISOString()) : null;
  const showNow = nowX !== null && nowX >= 0 && nowX <= width;

  // Open on the present, not on opening time: at 8pm nobody needs 11am.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = nowX !== null ? Math.max(0, nowX - HOUR_PX * 1.5) : 0;
  }, [date, axis.start]);

  const hours = Array.from({ length: axis.end - axis.start + 1 }, (_, i) => axis.start + i);
  const groups: [string, Resource[]][] = [];
  for (const s of stations) {
    const g = groups.find(([k]) => k === s.kind);
    if (g) g[1].push(s);
    else groups.push([s.kind, [s]]);
  }

  const snapAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = axis.start + (e.clientX - rect.left) / HOUR_PX;
    return Math.floor((h * 60) / SNAP_MIN) * (SNAP_MIN / 60);
  };

  if (!stations.length) {
    return <p className={styles.closed}>This venue has no stations set up yet.</p>;
  }

  return (
    <div className={styles.scroller} ref={scroller}>
      <div className={styles.gridInner} style={{ width: `calc(var(--label-w) + ${width}px)` }}>
        <div className={styles.headRow}>
          <div className={styles.corner} />
          <div className={styles.ticks} style={{ width }}>
            {hours.map((h) => (
              <span key={h} className={styles.tick} style={{ left: (h - axis.start) * HOUR_PX }}>
                {hhmm(h)}
              </span>
            ))}
            {showNow ? (
              <span className={styles.nowFlag} style={{ left: nowX! }}>
                {istTime(new Date(now).toISOString())}
              </span>
            ) : null}
          </div>
        </div>

        {groups.map(([kind, list]) => (
          <div key={kind}>
            <div className={styles.groupRow}>
              <div className={`${styles.groupLabel} eyebrow`}>{zoneLabel(kind)}</div>
              <div style={{ width }} />
            </div>
            {list.map((s) => {
              const mine = claims.filter((c) => c.resource_id === s.id);
              const myBlocks = blocks.filter((b) => b.resource_id === null || b.resource_id === s.id);
              return (
                <div className={styles.row} key={s.id}>
                  <div className={styles.rowLabel}>{s.label}</div>
                  <div
                    className={styles.lane}
                    style={{ width, backgroundSize: `${HOUR_PX / 2}px 100%` }}
                    onMouseMove={(e) => {
                      if (e.target !== e.currentTarget) return setHover(null);
                      setHover({ id: s.id, h: snapAt(e) });
                    }}
                    onMouseLeave={() => setHover(null)}
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      onEmpty(s.id, hhmm(snapAt(e)));
                    }}
                    role="presentation"
                  >
                    {showNow ? <span className={styles.now} style={{ left: nowX! }} aria-hidden="true" /> : null}
                    {hover?.id === s.id ? (
                      <span className={styles.ghost} style={{ left: (hover.h - axis.start) * HOUR_PX }}>
                        + {hhmm(hover.h)}
                      </span>
                    ) : null}

                    {myBlocks.map((b) => {
                      const left = Math.max(0, x(b.starts_at));
                      const right = Math.min(width, x(b.ends_at));
                      if (right <= left) return null;
                      return (
                        <button
                          key={`${b.id}-${s.id}`}
                          className={styles.blocked}
                          style={{ left, width: right - left }}
                          onClick={() => onBlock(b)}
                          title={b.reason ?? "Blocked"}
                          type="button"
                        >
                          <span>{b.reason ?? "Blocked"}</span>
                        </button>
                      );
                    })}

                    {mine.map((c) => {
                      const left = Math.max(0, x(c.starts_at));
                      const right = Math.min(width, x(c.expected_end_at));
                      const pending = c.order_status === "PENDING_APPROVAL" || c.status === "HELD";
                      return (
                        <button
                          key={c.id}
                          className={styles.booking}
                          data-source={c.source === "app" ? "app" : "desk"}
                          data-pending={pending}
                          data-done={isFinished(c, now)}
                          style={{ left, width: Math.max(right - left, 6) }}
                          onClick={() => onClaim(c)}
                          title={`${c.customer_name} · ${istTime(c.starts_at)}–${istTime(c.expected_end_at)} · ${sourceLabel(c.source)}${c.order_status === "PENDING_APPROVAL" ? " · needs approval" : ""}`}
                          type="button"
                        >
                          <span className={styles.bName}>{c.customer_name || "Customer"}</span>
                          <span className={styles.bTime}>
                            {istTime(c.starts_at)}–{istTime(c.expected_end_at)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {loading ? <div className={styles.loading} /> : null}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend}>
      <span><i data-k="app" /> XEX app</span>
      <span><i data-k="desk" /> Phone / walk-in / other</span>
      <span><i data-k="pending" /> Waiting for you or payment</span>
      <span><i data-k="blocked" /> Blocked</span>
      <span className={styles.legendHint}>Click an empty slot to book it</span>
    </div>
  );
}
