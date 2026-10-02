import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HoursRule, Revenue as RevenueData, RevenueDay } from "@/lib/api";
import { useSession, zoneLabel } from "@/lib/session";
import { methodLabel, sourceLabel } from "@/lib/status";
import { istDateKey, istShortDate, shiftDay, weekStart } from "@/lib/time";
import { EmptyState, ErrorState, LoadingRows, Panel } from "@/components/Panel";
import ui from "@/components/ui.module.css";
import { CashUp } from "./CashUp";
import styles from "./Revenue.module.css";

/* ============================================================
   Revenue: what the venue took, split the way the owner thinks
   about it — the XEX app versus the desk (phone, walk-in, other
   platforms). Pink is always app and blue always desk, the same
   as the calendar, so the split reads without a legend lookup.

   Figures are what was RECORDED: app amounts are what the customer
   paid (gross, before commission); desk amounts are whatever the
   owner typed. Desk bookings saved without an amount are counted
   and called out, never guessed at.

   Charts are plain HTML/CSS — a handful of bars does not need a
   charting library, and this keeps the page's weight where it was.
   ============================================================ */

type Preset = "week" | "last7" | "month" | "lastMonth" | "last30" | "custom";

const PRESETS: [Preset, string][] = [
  ["week", "This week"],
  ["last7", "Last 7 days"],
  ["month", "This month"],
  ["lastMonth", "Last month"],
  ["last30", "Last 30 days"],
  ["custom", "Dates…"],
];

/** The Revenue tab: the money over a range (Overview), or one day closed
 *  out against the till (Cash-up). One tab, two views — not another menu item. */
export function Revenue() {
  const [view, setView] = useState<"overview" | "cashup">("overview");
  return (
    <>
      <div className={`${ui.segments} ${styles.noPrint}`}>
        <button type="button" className={ui.segment} aria-pressed={view === "overview"} onClick={() => setView("overview")}>
          Overview
        </button>
        <button type="button" className={ui.segment} aria-pressed={view === "cashup"} onClick={() => setView("cashup")}>
          Cash-up
        </button>
      </div>
      {view === "overview" ? <Overview /> : <CashUp />}
    </>
  );
}

function Overview() {
  const { venue } = useSession();
  const today = istDateKey();
  const [preset, setPreset] = useState<Preset>("week");
  const [custom, setCustom] = useState({ from: shiftDay(today, -29), to: today });
  const [from, to] = useMemo(() => rangeFor(preset, today, custom), [preset, today, custom]);

  const q = useQuery({
    queryKey: ["revenue", venue.id, from, to],
    queryFn: () => api.revenue(venue.id, from, to),
    refetchInterval: 60_000,
  });

  return (
    <>
      <div className={styles.toolbar}>
        <div className={ui.segments}>
          {PRESETS.map(([k, label]) => (
            <button key={k} type="button" className={ui.segment} aria-pressed={preset === k} onClick={() => setPreset(k)}>
              {label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className={styles.dates}>
            <input className={ui.input} type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="From" />
            <span>to</span>
            <input className={ui.input} type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="To" />
          </div>
        ) : null}
        <span className={styles.range}>
          {istShortDate(from)} – {istShortDate(to)}
        </span>
      </div>

      {q.isPending ? (
        <Panel title="Revenue">
          <LoadingRows rows={5} />
        </Panel>
      ) : q.isError ? (
        <Panel title="Revenue">
          <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
        </Panel>
      ) : q.data.bookings === 0 ? (
        <Panel title="Revenue">
          <EmptyState title="No bookings in this range" body="Completed and upcoming confirmed bookings show up here, from the app and the desk alike." />
        </Panel>
      ) : (
        <Report data={q.data} stations={venue.resources.filter((r) => r.is_active).length} hours={venue.hours} />
      )}
    </>
  );
}

function Report({ data, stations, hours }: { data: RevenueData; stations: number; hours: HoursRule[] }) {
  const total = Number(data.total);
  const appTotal = data.by_source.filter((s) => s.source === "app").reduce((a, s) => a + Number(s.amount), 0);
  const deskTotal = total - appTotal;
  const capacity = data.open_hours * stations;
  const utilisation = capacity > 0 ? data.hours / capacity : 0;

  return (
    <>
      <div className={styles.stats}>
        <div className={styles.hero}>
          <div className="eyebrow" style={{ color: "var(--accent-deep)" }}>Revenue</div>
          <div className={`${styles.heroValue} display num`}>{rupees(total)}</div>
          <div className={styles.split}>
            <span><i className={styles.swatch} data-k="app" /> App {rupees(appTotal)}</span>
            <span><i className={styles.swatch} data-k="desk" /> Desk {rupees(deskTotal)}</span>
          </div>
        </div>
        <Stat label="Bookings" value={String(data.bookings)} foot={`${rupees(data.bookings ? total / data.bookings : 0)} average`} />
        <Stat label="Hours played" value={formatHours(data.hours)} foot={`${Math.round(utilisation * 100)}% of open station-hours`} />
        <Stat
          label="Collected"
          value={rupees(Number(data.collected))}
          foot={
            Number(data.outstanding) > 0
              ? `${rupees(Number(data.outstanding))} still owed`
              : Number(data.upcoming) > 0
                ? `${rupees(Number(data.upcoming))} due from upcoming`
                : "nothing owed"
          }
          warn={Number(data.outstanding) > 0}
        />
      </div>
      {data.unpriced ? (
        <p className={styles.note}>
          {data.unpriced} desk booking{data.unpriced === 1 ? " was" : "s were"} saved without an amount and count as ₹0. Set
          them from Cash-up.
        </p>
      ) : null}

      <Panel title="Revenue by day" aside="App and desk, stacked">
        <DailyChart days={data.by_day} />
      </Panel>

      <div className={styles.two}>
        <Panel title="By station" aside="Revenue · share of open hours used">
          <StationBars data={data} />
        </Panel>
        <Panel title="Busy hours" aside="Bookings by start time">
          <HourBars hours={data.by_start_hour} />
        </Panel>
      </div>

      <Panel title="When it's busy" aside="Share of stations in use, by weekday and hour">
        <Heatmap data={data} stations={stations} hours={hours} />
      </Panel>

      <div className={styles.two}>
        <Panel title="Customers" aside={`${data.customers} known · ${data.repeat} came back`}>
          <Customers data={data} />
        </Panel>
        <Panel title="How it was paid">
          <Methods data={data} />
        </Panel>
      </div>

      <Panel title="By source">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Booked via</th>
                <th className={styles.r}>Bookings</th>
                <th className={styles.r}>Revenue</th>
                <th className={styles.r}>Share</th>
              </tr>
            </thead>
            <tbody>
              {data.by_source.map((s) => (
                <tr key={s.source}>
                  <td>
                    <i className={styles.swatch} data-k={s.source === "app" ? "app" : "desk"} /> {sourceLabel(s.source)}
                  </td>
                  <td className={`${styles.r} num`}>{s.bookings}</td>
                  <td className={`${styles.r} num`}>{rupees(Number(s.amount))}</td>
                  <td className={`${styles.r} num`}>{total ? Math.round((Number(s.amount) / total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- daily */

interface Bucket {
  key: string;
  label: string;
  tip: string;
  app: number;
  desk: number;
  bookings: number;
}

/** A day per bar up to two months; past that, a week per bar so a year
 *  is 52 readable bars rather than 365 hairlines. */
function bucketDays(days: RevenueDay[]): Bucket[] {
  if (days.length <= 62) {
    return days.map((d) => ({
      key: d.date,
      label: istShortDate(d.date),
      tip: istShortDate(d.date),
      app: Number(d.app),
      desk: Number(d.desk),
      bookings: d.bookings,
    }));
  }
  const weeks = new Map<string, Bucket>();
  for (const d of days) {
    const w = weekStart(d.date);
    const b = weeks.get(w) ?? { key: w, label: istShortDate(w), tip: `Week of ${istShortDate(w)}`, app: 0, desk: 0, bookings: 0 };
    b.app += Number(d.app);
    b.desk += Number(d.desk);
    b.bookings += d.bookings;
    weeks.set(w, b);
  }
  return [...weeks.values()];
}

function DailyChart({ days }: { days: RevenueDay[] }) {
  const buckets = useMemo(() => bucketDays(days), [days]);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(...buckets.map((b) => b.app + b.desk), 1));
  const ticks = [0, max / 2, max];
  // Label every bar when there is room; otherwise about eight evenly.
  const every = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <div className={styles.chartBody}>
      <div className={styles.chartHead}>
        <span className={styles.legend}>
          <span><i className={styles.swatch} data-k="app" /> XEX app</span>
          <span><i className={styles.swatch} data-k="desk" /> Desk (phone, walk-in, other)</span>
        </span>
        <button className={styles.link} onClick={() => setAsTable((v) => !v)} type="button">
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Day</th>
                <th className={styles.r}>App</th>
                <th className={styles.r}>Desk</th>
                <th className={styles.r}>Total</th>
                <th className={styles.r}>Bookings</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}>
                  <td>{b.tip}</td>
                  <td className={`${styles.r} num`}>{rupees(b.app)}</td>
                  <td className={`${styles.r} num`}>{rupees(b.desk)}</td>
                  <td className={`${styles.r} num`}>{rupees(b.app + b.desk)}</td>
                  <td className={`${styles.r} num`}>{b.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.plot}>
          <div className={styles.yAxis}>
            <div className={styles.yInner}>
              {ticks.map((t) => (
                <span key={t} className="num" style={{ bottom: `${(t / max) * 100}%` }}>
                  {shortRupees(t)}
                </span>
              ))}
            </div>
          </div>
          <div className={styles.area}>
            <div className={styles.bars}>
              {ticks.map((t) => (
                <div key={t} className={styles.grid} style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
              {buckets.map((b, i) => {
                const total = b.app + b.desk;
                return (
                  <div
                    key={b.key}
                    className={styles.col}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    data-hover={hover === i}
                  >
                    <div className={styles.stack} style={{ height: `${(total / max) * 100}%` }}>
                      {b.desk > 0 ? <div className={styles.seg} data-k="desk" style={{ flexGrow: b.desk }} /> : null}
                      {b.app > 0 ? <div className={styles.seg} data-k="app" style={{ flexGrow: b.app }} /> : null}
                    </div>
                    {hover === i ? (
                      <div className={styles.tip} data-edge={i > buckets.length * 0.7 ? "right" : i < buckets.length * 0.3 ? "left" : undefined}>
                        <b>{b.tip}</b>
                        <span><i className={styles.swatch} data-k="app" /> App <em className="num">{rupees(b.app)}</em></span>
                        <span><i className={styles.swatch} data-k="desk" /> Desk <em className="num">{rupees(b.desk)}</em></span>
                        <span>Total <em className="num">{rupees(total)}</em></span>
                        <span>{b.bookings} booking{b.bookings === 1 ? "" : "s"}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className={styles.xAxis}>
              {buckets.map((b, i) => (
                <span key={b.key} style={{ visibility: i % every === 0 ? "visible" : "hidden" }}>
                  {b.label.replace(/^\w+ /, "")}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- stations */

function StationBars({ data }: { data: RevenueData }) {
  // Same identity colours as everywhere: pink app, blue desk, stacked.
  const rows = data.by_station;
  const max = Math.max(...rows.map((r) => Number(r.amount)), 1);
  let lastKind = "";
  return (
    <div className={styles.hbars}>
      {rows.map((r) => {
        const head = r.kind !== lastKind ? zoneLabel(r.kind) : null;
        lastKind = r.kind;
        return (
          <div key={r.resource_id}>
            {head ? <div className={`${styles.group} eyebrow`}>{head}</div> : null}
            <div
              className={styles.hrow}
              title={`${r.label}: ${rupees(Number(r.amount))} (app ${rupees(Number(r.app))}, desk ${rupees(Number(r.desk))}) · ${r.bookings} bookings · ${formatHours(r.hours)}`}
            >
              <span className={styles.hlabel}>{r.label}</span>
              <span className={styles.htrack}>
                <span className={styles.hstack} style={{ width: `${(Number(r.amount) / max) * 100}%` }}>
                  {Number(r.desk) > 0 ? <span className={styles.hseg} data-k="desk" style={{ flexGrow: Number(r.desk) }} /> : null}
                  {Number(r.app) > 0 ? <span className={styles.hseg} data-k="app" style={{ flexGrow: Number(r.app) }} /> : null}
                </span>
              </span>
              <span className={`${styles.hval} num`}>{rupees(Number(r.amount))}</span>
              <span className={`${styles.hpct} num`}>{Math.round(r.utilisation * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- heatmap */

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, as the owner reads a week
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STEPS = [0.15, 0.35, 0.55, 0.75, 1];

/* One hue, light to dark: magnitude is "how full", not "app vs desk", so
   it must not borrow either identity colour. Cells show the % on hover and
   the busiest slot is named in words underneath. */
function Heatmap({ data, stations, hours }: { data: RevenueData; stations: number; hours: HoursRule[] }) {
  const [lo, hi] = useMemo(() => {
    const opens = hours.map((h) => Number(h.opens_at.slice(0, 2)));
    const closes = hours.map((h) => Math.ceil(Number(h.closes_at.slice(0, 2)) + Number(h.closes_at.slice(3, 5)) / 60));
    if (opens.length) return [Math.min(...opens), Math.min(24, Math.max(...closes))];
    return [10, 23];
  }, [hours]);
  const cols = Array.from({ length: Math.max(hi - lo, 1) }, (_, i) => lo + i);

  const util = (wd: number, h: number) => {
    const n = data.weekday_count[wd] * stations;
    return n > 0 ? Math.min(1, (data.heatmap[wd]?.[h] ?? 0) / n) : 0;
  };
  let peak = { wd: 0, h: lo, v: 0 };
  let quiet = { wd: 0, h: lo, v: 2 };
  for (const wd of WEEK) {
    if (!data.weekday_count[wd]) continue;
    for (const h of cols) {
      const v = util(wd, h);
      if (v > peak.v) peak = { wd, h, v };
      if (v < quiet.v) quiet = { wd, h, v };
    }
  }

  return (
    <div className={styles.chartBody}>
      <div className={styles.heat} style={{ gridTemplateColumns: `40px repeat(${cols.length}, minmax(22px, 1fr))` }}>
        <span />
        {cols.map((h) => (
          <span key={h} className={`${styles.heatHour} num`}>
            {h % 2 === 0 || cols.length <= 14 ? pad(h) : ""}
          </span>
        ))}
        {WEEK.map((wd) => (
          <HeatRow key={wd} wd={wd} cols={cols} util={util} none={!data.weekday_count[wd]} />
        ))}
      </div>
      <div className={styles.heatFoot}>
        <span className={styles.heatScale}>
          <span>Quiet</span>
          {STEPS.map((v) => (
            <i key={v} style={{ opacity: v }} />
          ))}
          <span>Full</span>
        </span>
        {peak.v > 0 ? (
          <span className={styles.note}>
            Busiest: <b>{DAY_NAMES[peak.wd]} {pad(peak.h)}:00</b> ({Math.round(peak.v * 100)}% of stations). Quietest:{" "}
            <b>
              {DAY_NAMES[quiet.wd]} {pad(quiet.h)}:00
            </b>{" "}
            ({Math.round(quiet.v * 100)}%) — a candidate for an off-peak price.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function HeatRow({ wd, cols, util, none }: { wd: number; cols: number[]; util: (wd: number, h: number) => number; none: boolean }) {
  return (
    <>
      <span className={styles.heatDay}>{DAY_NAMES[wd]}</span>
      {cols.map((h) => {
        const v = util(wd, h);
        return (
          <span
            key={h}
            className={styles.heatCell}
            data-none={none}
            title={none ? `No ${DAY_NAMES[wd]} in this range` : `${DAY_NAMES[wd]} ${pad(h)}:00 — ${Math.round(v * 100)}% of stations in use`}
          >
            <i style={{ opacity: v === 0 ? 0 : 0.12 + v * 0.88 }} />
          </span>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------- customers */

function Customers({ data }: { data: RevenueData }) {
  if (!data.top_customers.length) {
    return <p className={styles.note} style={{ padding: "0 24px 20px" }}>No customers with a phone number or app account in this range yet.</p>;
  }
  const rate = data.customers ? Math.round((data.repeat / data.customers) * 100) : 0;
  return (
    <div className={styles.chartBody} style={{ paddingLeft: 0, paddingRight: 0 }}>
      <p className={styles.note} style={{ padding: "0 24px" }}>
        <b>{rate}%</b> of known customers came more than once.
        {data.anonymous ? ` ${data.anonymous} walk-in booking${data.anonymous === 1 ? "" : "s"} had no phone number and aren't counted.` : ""}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Customer</th>
              <th className={styles.r}>Visits</th>
              <th className={styles.r}>Hours</th>
              <th className={styles.r}>Spent</th>
              <th className={styles.r}>Last</th>
            </tr>
          </thead>
          <tbody>
            {data.top_customers.map((c) => (
              <tr key={`${c.name}-${c.phone}`}>
                <td>
                  <i className={styles.swatch} data-k={c.source} /> {c.name || "—"}
                  {c.phone ? <span className={styles.phone}> {formatPhoneShort(c.phone)}</span> : null}
                </td>
                <td className={`${styles.r} num`}>{c.bookings}</td>
                <td className={`${styles.r} num`}>{formatHours(c.hours)}</td>
                <td className={`${styles.r} num`}>{rupees(Number(c.amount))}</td>
                <td className={`${styles.r} num`}>{istShortDate(istDateKey(new Date(c.last_visit))).replace(/^\w+ /, "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatPhoneShort(p: string) {
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `${d.slice(2, 7)} ${d.slice(7)}` : p;
}

/* ---------------------------------------------------------------- methods */

function Methods({ data }: { data: RevenueData }) {
  const rows = (["online", "cash", "upi", "card", "other"] as const)
    .map((m) => ({ m, v: Number(data.by_method[m] ?? 0) }))
    .filter((r) => r.v > 0);
  const collected = Number(data.collected);
  const owed = Number(data.outstanding) + Number(data.upcoming);
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m}>
              <td>{methodLabel(r.m)}</td>
              <td className={`${styles.r} num`}>{rupees(r.v)}</td>
              <td className={`${styles.r} num`}>{collected ? Math.round((r.v / collected) * 100) : 0}%</td>
            </tr>
          ))}
          <tr className={styles.totalRow}>
            <td>Collected</td>
            <td className={`${styles.r} num`}>{rupees(collected)}</td>
            <td />
          </tr>
          {owed > 0 ? (
            <tr>
              <td>Not yet collected</td>
              <td className={`${styles.r} num`}>{rupees(owed)}</td>
              <td className={`${styles.r} num`}>{data.unpaid_count} booking{data.unpaid_count === 1 ? "" : "s"}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- hours */

function HourBars({ hours }: { hours: RevenueData["by_start_hour"] }) {
  // Trim to the hours anything started in, padded by one, so an 11–23
  // venue isn't drawn as a mostly empty 24-hour axis.
  const used = hours.filter((h) => h.bookings > 0).map((h) => h.hour);
  const lo = Math.max(0, Math.min(...used) - 1);
  const hi = Math.min(23, Math.max(...used) + 1);
  const shown = hours.filter((h) => h.hour >= lo && h.hour <= hi);
  const max = Math.max(...shown.map((h) => h.bookings), 1);
  const peak = shown.reduce((a, b) => (b.bookings > a.bookings ? b : a), shown[0]);
  return (
    <div className={styles.chartBody}>
      <div className={styles.hours}>
        {shown.map((h) => (
          <div key={h.hour} className={styles.hcol} title={`${pad(h.hour)}:00 — ${h.bookings} booking${h.bookings === 1 ? "" : "s"} started`}>
            <span className={`${styles.hnum} num`}>{h.bookings || ""}</span>
            <span className={styles.hbar} data-peak={h.hour === peak.hour} style={{ height: `${(h.bookings / max) * 100}%` }} />
            <span className={`${styles.hlab} num`}>{pad(h.hour)}</span>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        Busiest start time: <b>{pad(peak.hour)}:00</b> ({peak.bookings} booking{peak.bookings === 1 ? "" : "s"}).
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- bits */

function Stat({ label, value, foot, warn }: { label: string; value: string; foot: string; warn?: boolean }) {
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

function rangeFor(p: Preset, today: string, custom: { from: string; to: string }): [string, string] {
  switch (p) {
    case "week": {
      const w = weekStart(today);
      return [w, shiftDay(w, 6)];
    }
    case "last7":
      return [shiftDay(today, -6), today];
    case "month":
      return [`${today.slice(0, 8)}01`, lastOfMonth(today)];
    case "lastMonth": {
      const prev = shiftDay(`${today.slice(0, 8)}01`, -1);
      return [`${prev.slice(0, 8)}01`, prev];
    }
    case "last30":
      return [shiftDay(today, -29), today];
    case "custom":
      return custom.to < custom.from ? [custom.from, custom.from] : [custom.from, custom.to];
  }
}

function lastOfMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key.slice(0, 8)}${String(d).padStart(2, "0")}`;
}

/** Round an axis max up to the next "nice" step, finely enough that the
 *  tallest bar fills most of the plot (₹2,136 -> ₹2,500, not ₹5,000). */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function shortRupees(n: number): string {
  // up to two decimals, trailing zeros dropped: ₹1.25k, ₹2.5k, ₹3k
  const trim = (v: number) => String(Number(v.toFixed(2)));
  if (n >= 100_000) return `₹${trim(n / 100_000)}L`;
  if (n >= 1000) return `₹${trim(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

function formatHours(h: number): string {
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

function pad(h: number) {
  return String(h).padStart(2, "0");
}
