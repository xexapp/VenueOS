import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Block, Claim, Resource } from "@/lib/api";
import { orderedStations, useSession, zoneLabel } from "@/lib/session";
import { clashingBlocks, clashingClaims, useInvalidateSchedule, useSchedule } from "@/lib/schedule";
import { minutesUntil, stationState } from "@/lib/floor";
import type { StationState } from "@/lib/floor";
import { formatMinutes, istDateKey, istTime } from "@/lib/time";
import { ClaimDialog } from "@/components/ClaimDialog";
import { CollectDialog, rupees } from "@/components/Payment";
import { payLabel, payState } from "@/lib/status";
import { ErrorState } from "@/components/Panel";
import { Modal } from "@/components/Modal";
import ui from "@/components/ui.module.css";
import styles from "./Floor.module.css";

/* ============================================================
   The Floor: every station as a tile, showing what it is doing
   right now. Built for the desk tablet — big targets, one tap per
   common action:

     free      → Start 1h / 2h (walk-in), or "More…" for name/phone
     playing   → countdown, +30m / +1h, End
     overtime  → "ended 4 min ago": +30m, or Done
     blocked   → why, and until when

   Everything here is a thin layer over endpoints the calendar
   already uses (create booking, PATCH claim, release), so a walk-in
   started here is an ordinary desk booking everywhere else.

   Later this grid becomes the seat map: the tiles stay the same,
   only their position comes from resources.metadata.layout.
   ============================================================ */

const QUICK = [60, 120];
const DURATIONS = [30, 60, 90, 120, 180, 240];

type Filter = "all" | string;

export function Floor() {
  const { venue } = useSession();
  const today = istDateKey();
  const q = useSchedule(venue.id, today, today);
  const stations = useMemo(() => orderedStations(venue), [venue]);

  // Countdowns move every 15s; the data itself polls every 30s.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const [filter, setFilter] = useState<Filter>("all");
  const [starting, setStarting] = useState<{ station: Resource; cap: number | null; minutes?: number } | null>(null);
  const [open, setOpen] = useState<Claim | null>(null);
  const [collecting, setCollecting] = useState<Claim | null>(null);

  const claims = q.data?.claims ?? [];
  const blocks = q.data?.blocks ?? [];
  const states = useMemo(
    () => stations.map((s) => ({ station: s, state: stationState(s, claims, blocks, now) })),
    [stations, claims, blocks, now],
  );

  const kinds = [...new Set(stations.map((s) => s.kind))];
  const summary = kinds.map((k) => {
    const list = states.filter((x) => x.station.kind === k);
    return { kind: k, free: list.filter((x) => x.state.kind === "free").length, total: list.length };
  });
  const endingSoon = states.filter((x) => x.state.kind === "playing" && x.state.endingSoon).length;
  const overtime = states.filter((x) => x.state.kind === "overtime").length;

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1 className={`${styles.title} display`}>Floor</h1>
          <p className={styles.sub}>
            {istTime(new Date(now).toISOString())} ·{" "}
            {summary.map((s, i) => (
              <span key={s.kind}>
                {i ? " · " : ""}
                <b className="num">{s.free}</b> of {s.total} {zoneLabel(s.kind)} free
              </span>
            ))}
            {endingSoon ? <span className={styles.warn}> · {endingSoon} ending soon</span> : null}
            {overtime ? <span className={styles.warn}> · {overtime} over time</span> : null}
          </p>
        </div>
        <div className={styles.headActions}>
          <div className={ui.segments}>
            <button type="button" className={ui.segment} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All
            </button>
            {kinds.map((k) => (
              <button key={k} type="button" className={ui.segment} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {zoneLabel(k)}
              </button>
            ))}
          </div>
          <FullscreenButton />
        </div>
      </div>

      {q.isError ? (
        <div className={styles.panel}>
          <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
        </div>
      ) : (
        kinds
          .filter((k) => filter === "all" || filter === k)
          .map((k) => (
            <section key={k} className={styles.zone}>
              <h2 className={`${styles.zoneTitle} eyebrow`}>{zoneLabel(k)}</h2>
              <div className={styles.grid} aria-busy={q.isPending}>
                {states
                  .filter((x) => x.station.kind === k)
                  .map(({ station, state }) => (
                    <Tile
                      key={station.id}
                      station={station}
                      state={state}
                      now={now}
                      loading={q.isPending}
                      onStart={(minutes) => setStarting({ station, cap: minutesUntil(state.kind === "free" ? state.next : null, now), minutes })}
                      onOpen={(c) => setOpen(c)}
                      onCollect={(c) => setCollecting(c)}
                    />
                  ))}
              </div>
            </section>
          ))
      )}

      {starting ? (
        <StartDialog
          station={starting.station}
          cap={starting.cap}
          initialMinutes={starting.minutes}
          claims={claims}
          blocks={blocks}
          onClose={() => setStarting(null)}
        />
      ) : null}
      {open ? <ClaimDialog claim={open} onClose={() => setOpen(null)} /> : null}
      {collecting ? <CollectDialog claim={collecting} onClose={() => setCollecting(null)} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------- tile */

function Tile({
  station,
  state,
  now,
  loading,
  onStart,
  onOpen,
  onCollect,
}: {
  station: Resource;
  state: StationState;
  now: number;
  loading: boolean;
  onStart: (minutes?: number) => void;
  onOpen: (c: Claim) => void;
  onCollect: (c: Claim) => void;
}) {
  const { venue } = useSession();
  const invalidate = useInvalidateSchedule();

  const claim = state.kind === "playing" || state.kind === "overtime" || state.kind === "pending" ? state.claim : null;
  const buffer = claim ? (venue.bookables.find((b) => b.id === claim.bookable_id)?.buffer_minutes ?? 0) : 0;

  const extend = useMutation({
    mutationFn: (mins: number) => {
      // From the later of "session end" and "now": extending an overtime
      // session gives them 30 more minutes from now, not from when it ended.
      const sessionEnd = new Date(claim!.expected_end_at).getTime() - buffer * 60_000;
      const base = Math.max(sessionEnd, Math.ceil(now / 60_000) * 60_000);
      return api.updateClaim(claim!.id, { ends_at: new Date(base + mins * 60_000).toISOString() });
    },
    onSuccess: () => invalidate(),
  });
  const release = useMutation({
    mutationFn: () => api.releaseClaim(claim!.id),
    onSuccess: () => {
      invalidate();
      if (claim && claim.source !== "app" && payState(claim) !== "paid") onCollect(claim);
    },
  });
  const busy = extend.isPending || release.isPending;
  const error = extend.error ?? release.error;

  if (loading) return <div className={styles.tile} data-state="loading" />;

  const cap = state.kind === "free" ? minutesUntil(state.next, now) : null;

  return (
    <div className={styles.tile} data-state={state.kind === "playing" && state.endingSoon ? "ending" : state.kind}>
      <div className={styles.tileHead}>
        <span className={styles.label}>{station.label}</span>
        <span className={styles.badge}>{badge(state)}</span>
      </div>

      {state.kind === "free" ? (
        <>
          <div className={styles.main}>
            {state.next ? (
              <>
                Free until <b className="num">{istTime(new Date(state.next.at).toISOString())}</b>
                <span className={styles.minor}>
                  {" "}
                  · {formatMinutes(cap ?? 0)} · then {state.next.label}
                </span>
              </>
            ) : (
              <>Free for the rest of the day</>
            )}
          </div>
          <div className={styles.actions}>
            {QUICK.map((m) => (
              <button
                key={m}
                type="button"
                className={`${ui.btn} ${ui.primary} ${styles.big}`}
                disabled={cap !== null && cap < m}
                title={cap !== null && cap < m ? `Only ${formatMinutes(cap)} before the next booking` : undefined}
                onClick={() => onStart(m)}
              >
                Start {formatMinutes(m)}
              </button>
            ))}
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} onClick={() => onStart()} disabled={cap !== null && cap < 15}>
              More…
            </button>
          </div>
        </>
      ) : state.kind === "playing" ? (
        <>
          <button type="button" className={styles.who} onClick={() => onOpen(state.claim)}>
            <span className={styles.name}>{state.claim.customer_name || "Customer"}</span>
            <span className={`${styles.left} num`}>{formatMinutes(state.minsLeft)} left</span>
          </button>
          <div className={styles.bar}>
            <span style={{ width: `${state.progress * 100}%` }} />
          </div>
          <div className={styles.minor}>
            until {istTime(state.claim.expected_end_at)}
            {state.next ? ` · next ${state.next.label} ${istTime(new Date(state.next.at).toISOString())}` : ""}
          </div>
          <PayTag claim={state.claim} onCollect={onCollect} />
          <div className={styles.actions}>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} disabled={busy} onClick={() => extend.mutate(30)}>
              +30m
            </button>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} disabled={busy} onClick={() => extend.mutate(60)}>
              +1h
            </button>
            <button type="button" className={`${ui.btn} ${ui.primary} ${styles.big}`} disabled={busy} onClick={() => release.mutate()}>
              End
            </button>
          </div>
        </>
      ) : state.kind === "overtime" ? (
        <>
          <button type="button" className={styles.who} onClick={() => onOpen(state.claim)}>
            <span className={styles.name}>{state.claim.customer_name || "Customer"}</span>
            <span className={`${styles.left} num`}>ended {state.minsOver ? `${state.minsOver} min ago` : "just now"}</span>
          </button>
          <div className={styles.minor}>Still playing? Extend it, or mark it done.</div>
          <PayTag claim={state.claim} onCollect={onCollect} />
          <div className={styles.actions}>
            <button type="button" className={`${ui.btn} ${ui.primary} ${styles.big}`} disabled={busy} onClick={() => extend.mutate(30)}>
              +30m
            </button>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} disabled={busy} onClick={() => extend.mutate(60)}>
              +1h
            </button>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} disabled={busy} onClick={() => release.mutate()}>
              Done
            </button>
          </div>
        </>
      ) : state.kind === "pending" ? (
        <>
          <button type="button" className={styles.who} onClick={() => onOpen(state.claim)}>
            <span className={styles.name}>{state.claim.customer_name || "Customer"}</span>
            <span className={styles.left}>
              {state.claim.order_status === "PENDING_APPROVAL" ? "needs your approval" : "paying in the app"}
            </span>
          </button>
          <div className={styles.minor}>
            {istTime(state.claim.starts_at)}–{istTime(state.claim.expected_end_at)} · held for them
          </div>
          <div className={styles.actions}>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${styles.big}`} onClick={() => onOpen(state.claim)}>
              Open
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.main}>{state.block.reason || "Out of service"}</div>
          <div className={styles.minor}>
            {state.freeAt ? `until ${istTime(new Date(state.freeAt).toISOString())}` : ""}
            {state.block.resource_id === null ? " · whole venue" : ""}
          </div>
        </>
      )}

      {error ? <div className={styles.err}>{describe(error)}</div> : null}
    </div>
  );
}

/** "₹200 unpaid · Collect" on a running tile, so money is visible before
 *  the session ends rather than remembered after. */
function PayTag({ claim, onCollect }: { claim: Claim; onCollect: (c: Claim) => void }) {
  const state = payState(claim);
  if (state === "free") return null;
  if (state === "unpaid") {
    return (
      <button type="button" className={styles.pay} data-state="unpaid" onClick={() => onCollect(claim)}>
        <span className="num">{rupees(claim.amount)}</span> unpaid · <u>Collect</u>
      </button>
    );
  }
  return (
    <span className={styles.pay} data-state="paid">
      <span className="num">{rupees(claim.amount)}</span> · {payLabel(claim)}
    </span>
  );
}

function badge(s: StationState): string {
  switch (s.kind) {
    case "free":
      return "Free";
    case "playing":
      return s.endingSoon ? "Ending soon" : "Playing";
    case "overtime":
      return "Over time";
    case "pending":
      return "Held";
    case "blocked":
      return "Blocked";
  }
}

function describe(err: Error): string {
  if (err instanceof ApiError && err.status === 409) {
    const c = err.body.conflicts?.[0];
    if (c) return `Next booking (${c.customer_name || "customer"}) starts ${istTime(c.starts_at)} — can't extend past it.`;
    if (err.body.code === "blocked") return "Blocked time is in the way.";
  }
  return err.message;
}

/* ---------------------------------------------------------------- start */

/* A walk-in in two taps: the duration is already chosen from the tile,
   the name is optional ("Walk-in" if blank), the amount is the list
   price. The one thing it guards is the next booking on the station. */
function StartDialog({
  station,
  cap,
  initialMinutes,
  claims,
  blocks,
  onClose,
}: {
  station: Resource;
  cap: number | null;
  initialMinutes?: number;
  claims: Claim[];
  blocks: Block[];
  onClose: () => void;
}) {
  const { venue } = useSession();
  const invalidate = useInvalidateSchedule();
  const bookable = venue.bookables.find((b) => b.is_active && b.resource_ids.includes(station.id));

  const options = DURATIONS.filter((d) => cap === null || d <= cap);
  if (cap !== null && cap >= 15 && !options.includes(cap) && cap < 240) options.push(cap);
  options.sort((a, b) => a - b);

  const [minutes, setMinutes] = useState(initialMinutes && options.includes(initialMinutes) ? initialMinutes : (options.find((d) => d === 60) ?? options[options.length - 1] ?? 30));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState<string | null>(null);

  const listPrice =
    bookable && bookable.pricing_type === "paid" ? String(Math.round((Number(bookable.price) * minutes) / bookable.duration_minutes)) : "";
  const shownAmount = amount ?? listPrice;

  // Start on the current minute; the server truncates to the minute too.
  const [startMs] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const endMs = startMs + minutes * 60_000;
  const blockedEnd = endMs + (bookable?.buffer_minutes ?? 0) * 60_000;
  const clash = clashingClaims(claims, station.id, startMs, blockedEnd);
  const blocked = clashingBlocks(blocks, station.id, startMs, blockedEnd);

  const start = useMutation({
    mutationFn: () =>
      api.createBooking({
        resource_id: station.id,
        bookable_id: bookable?.id,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        customer_name: name.trim() || "Walk-in",
        customer_phone: phone.trim() || undefined,
        source: "walk_in",
        amount: shownAmount.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal
      title={`Start ${station.label}`}
      sub={`Walk-in · from ${istTime(new Date(startMs).toISOString())}`}
      onClose={onClose}
      footer={
        <>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={`${ui.btn} ${ui.primary}`}
            disabled={start.isPending || clash.length > 0 || blocked.length > 0 || options.length === 0}
            onClick={() => start.mutate()}
            type="button"
          >
            {start.isPending ? "Starting…" : `Start ${formatMinutes(minutes)} · until ${istTime(new Date(endMs).toISOString())}`}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clash.length && !blocked.length) start.mutate();
        }}
        style={{ display: "contents" }}
      >
        <div className={ui.field}>
          <span className={ui.label}>How long</span>
          <div className={ui.segments}>
            {options.map((d) => (
              <button key={d} type="button" className={ui.segment} aria-pressed={minutes === d} onClick={() => setMinutes(d)}>
                {d === cap ? `Until next (${formatMinutes(d)})` : formatMinutes(d)}
              </button>
            ))}
          </div>
          {cap !== null ? <span className={ui.hint}>Next booking on {station.label} in {formatMinutes(cap)}.</span> : null}
        </div>
        <div className={ui.row}>
          <label className={ui.field}>
            <span className={ui.label}>Name (optional)</span>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in" maxLength={80} autoFocus />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Phone (optional)</span>
            <input className={ui.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" inputMode="tel" />
          </label>
        </div>
        <label className={ui.field}>
          <span className={ui.label}>Amount (₹)</span>
          <input
            className={`${ui.input} num`}
            value={shownAmount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            placeholder="0"
          />
          {amount === null && listPrice ? <span className={ui.hint}>List price for {formatMinutes(minutes)}</span> : null}
        </label>
        {clash.length ? (
          <div className={ui.error}>
            {station.label} is booked from {istTime(clash[0].starts_at)} ({clash[0].customer_name || "customer"}). Pick a shorter time.
          </div>
        ) : null}
        {blocked.length ? <div className={ui.error}>{station.label} is blocked from {istTime(blocked[0].starts_at)}. Pick a shorter time.</div> : null}
        {start.error ? <div className={ui.error}>{start.error.message}</div> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- fullscreen */

/** For the desk tablet: the Floor on its own, no browser chrome. */
function FullscreenButton() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  if (!document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className={`${ui.btn} ${ui.ghost} ${ui.small}`}
      onClick={() => (full ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
    >
      {full ? "Exit full screen" : "Full screen"}
    </button>
  );
}
