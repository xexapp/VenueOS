import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Claim } from "@/lib/api";
import { orderedStations, useSession, zoneLabel } from "@/lib/session";
import { useSchedule } from "@/lib/schedule";
import { isRunning, occupiesResource, orderStatusView, sourceLabel, TONE_STYLE } from "@/lib/status";
import { istDateKey, istLongDate, istTime } from "@/lib/time";
import { Pulse } from "@/components/Pulse";
import { BookingDialog } from "@/components/BookingDialog";
import { ClaimDialog } from "@/components/ClaimDialog";
import { EmptyState, ErrorState, LoadingRows, Panel, PanelBody } from "@/components/Panel";
import ui from "@/components/ui.module.css";
import styles from "./Dashboard.module.css";

export function Dashboard() {
  const { venue, me } = useSession();
  const today = istDateKey();
  const q = useSchedule(venue.id, today, today);
  const stations = useMemo(() => orderedStations(venue), [venue]);
  const [open, setOpen] = useState<Claim | null>(null);
  const [adding, setAdding] = useState(false);

  // Re-derive "now" every 30s so "free right now" and "ending soon"
  // move on their own between refetches.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const dayStart = new Date(`${today}T00:00:00+05:30`).getTime();
  const live = useMemo(
    () =>
      (q.data?.claims ?? []).filter(
        (c) => occupiesResource(c.status) && new Date(c.starts_at).getTime() >= dayStart,
      ),
    [q.data, dayStart],
  );

  const stats = useMemo(() => {
    const running = new Set(live.filter((c) => isRunning(c, now)).map((c) => c.resource_id));
    // A blocked station is not free either — same rule as the calendar's bar.
    const blockedNow = (q.data?.blocks ?? []).filter(
      (b) => new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() > now,
    );
    const isBlocked = (id: string) => blockedNow.some((b) => b.resource_id === null || b.resource_id === id);
    const byKind = new Map<string, { free: number; total: number }>();
    for (const s of stations) {
      const k = byKind.get(s.kind) ?? { free: 0, total: 0 };
      k.total += 1;
      if (!running.has(s.id) && !isBlocked(s.id)) k.free += 1;
      byKind.set(s.kind, k);
    }
    return {
      booked: live.length,
      remaining: live.filter((c) => new Date(c.starts_at).getTime() > now).length,
      app: live.filter((c) => c.source === "app").length,
      desk: live.filter((c) => c.source !== "app").length,
      needsApproval: live.filter((c) => c.order_status === "PENDING_APPROVAL").length,
      byKind: [...byKind.entries()],
    };
  }, [live, stations, now, q.data]);

  const upcoming = useMemo(
    () =>
      live
        .filter((c) => new Date(c.expected_end_at).getTime() > now)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .slice(0, 8),
    [live, now],
  );

  const needsYou = useMemo(() => {
    const items: { id: string; claim: Claim; text: string; action: string; urgent: boolean }[] = [];
    for (const c of live) {
      if (c.order_status === "PENDING_APPROVAL") {
        items.push({
          id: c.id,
          claim: c,
          text: `${c.customer_name} wants ${c.resource_label} at ${istTime(c.starts_at)} (app request)`,
          action: "Approve or decline",
          urgent: true,
        });
      }
    }
    // Sessions finishing in the next 15 minutes: the desk's cue to tell
    // the player, or to offer an extension before someone else walks in.
    for (const c of live) {
      const left = new Date(c.expected_end_at).getTime() - now;
      if (isRunning(c, now) && left <= 15 * 60_000) {
        items.push({
          id: `${c.id}-ending`,
          claim: c,
          text: `${c.customer_name} on ${c.resource_label} finishes at ${istTime(c.expected_end_at)}`,
          action: "View",
          urgent: false,
        });
      }
    }
    return items;
  }, [live, now]);

  const firstName = me?.full_name.split(/\s+/)[0];
  const hour = Number(istTime(new Date(now).toISOString()).slice(0, 2));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const day = q.data?.days[0];

  return (
    <>
      <div className={styles.masthead}>
        <div>
          <h1 className={`${styles.greeting} display`}>
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className={styles.sub}>
            {istLongDate(today)} · {venue.name}
            {day?.opens_at && day.closes_at ? ` · open ${istTime(day.opens_at)}–${istTime(day.closes_at)}` : ""}
          </p>
        </div>
        <div className={styles.live}>
          <span className={styles.dot} data-stale={q.isFetching} />
          {q.isError ? "Offline" : "Live"}
        </div>
        <button className={`${ui.btn} ${ui.primary}`} onClick={() => setAdding(true)} type="button">
          + New booking
        </button>
      </div>

      {/* Hero number plus supporting figures, all derived from claims.
          Nothing here is invented: revenue only counts what was recorded. */}
      <div className={styles.stats}>
        <div className={styles.hero}>
          <div className={`${styles.heroLabel} eyebrow`}>Booked today</div>
          <div className={`${styles.heroValue} display num`}>{q.isPending ? "—" : stats.booked}</div>
          <div className={styles.heroFoot}>{q.isPending ? " " : `${stats.remaining} still to come`}</div>
        </div>
        <Stat
          label="Free right now"
          value={q.isPending ? "—" : stats.byKind.map(([, v]) => v.free).reduce((a, b) => a + b, 0)}
          foot={stats.byKind.map(([k, v]) => `${v.free}/${v.total} ${zoneLabel(k)}`).join(" · ")}
        />
        <Stat label="Needs approval" value={q.isPending ? "—" : stats.needsApproval} foot={stats.needsApproval ? "Waiting on you" : "Nothing waiting"} />
        <Stat label="App vs desk" value={q.isPending ? "—" : `${stats.app} / ${stats.desk}`} foot="XeX app / phone & walk-in" />
      </div>

      {q.isPending ? (
        <div className={styles.pulseSkeleton} aria-busy="true" />
      ) : q.isError ? null : (
        <Pulse resources={stations} claims={live} opensAt={day?.opens_at ?? null} closesAt={day?.closes_at ?? null} />
      )}

      <div className={styles.split}>
        <Panel title="Up next" action={<Link to="/calendar">Open calendar ↗</Link>}>
          {q.isPending ? (
            <LoadingRows />
          ) : q.isError ? (
            <ErrorState body={q.error.message} onRetry={() => q.refetch()} />
          ) : upcoming.length === 0 ? (
            <EmptyState title="Nothing left today" body="New bookings from the app appear here as they come in. Phone and walk-in bookings: use + New booking." />
          ) : (
            <PanelBody>
              {upcoming.map((c) => (
                <Row key={c.id} claim={c} running={isRunning(c, now)} onOpen={() => setOpen(c)} />
              ))}
            </PanelBody>
          )}
        </Panel>

        <Panel title="Needs you" aside={needsYou.length ? String(needsYou.length) : undefined}>
          {q.isPending ? (
            <LoadingRows rows={3} />
          ) : q.isError ? (
            <ErrorState body="Could not reach the server." onRetry={() => q.refetch()} />
          ) : needsYou.length === 0 ? (
            <EmptyState title="All clear" body="Nothing needs a decision right now." />
          ) : (
            <PanelBody>
              {needsYou.map((t) => (
                <div className={styles.task} key={t.id}>
                  <span className={styles.taskDot} data-urgent={t.urgent} />
                  <div>
                    <div className={styles.taskText}>{t.text}</div>
                    <button className={styles.taskAction} type="button" onClick={() => setOpen(t.claim)}>
                      {t.action}
                    </button>
                  </div>
                </div>
              ))}
            </PanelBody>
          )}
        </Panel>
      </div>

      {open ? <ClaimDialog claim={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <BookingDialog draft={{ dateKey: today }} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function Stat({ label, value, foot }: { label: string; value: string | number; foot: string }) {
  return (
    <div className={styles.stat}>
      <div className={`${styles.statLabel} eyebrow`}>{label}</div>
      <div className={`${styles.statValue} display num`}>{value}</div>
      <div className={styles.statFoot}>{foot}</div>
    </div>
  );
}

function Row({ claim, running, onOpen }: { claim: Claim; running: boolean; onOpen: () => void }) {
  const view = running ? { label: "Playing now", tone: "attention" as const } : orderStatusView(claim.order_status);
  const tone = TONE_STYLE[view.tone];
  return (
    <button className={styles.row} onClick={onOpen} type="button">
      <div className={`${styles.rowTime} display num`}>{istTime(claim.starts_at)}</div>
      <div className={styles.rowWho}>
        <span className={styles.rowName}>{claim.customer_name || "Customer"}</span>
        <span className={styles.rowWhere}>
          {claim.resource_label} · until {istTime(claim.expected_end_at)} · {sourceLabel(claim.source)}
        </span>
      </div>
      <div className={styles.rowRight}>
        <span className={styles.chip} style={{ color: tone.color, background: tone.background }}>
          {view.label}
        </span>
      </div>
    </button>
  );
}
