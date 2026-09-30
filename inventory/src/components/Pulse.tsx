import { useMemo } from "react";
import type { Claim, Resource } from "@/lib/api";
import { occupiesResource } from "@/lib/status";
import { istHourOffset } from "@/lib/time";
import styles from "./Pulse.module.css";

/* ============================================================
   The Pulse — booked hours per resource across the trading day.

   Unlike the mockup this derives everything from real claims:
   the axis comes from the venue's availability rules, the bars
   come from claim start/end, and the percentage is occupied
   minutes over open minutes. No hardcoded 06:00–24:00.
   ============================================================ */

interface Props {
  resources: Resource[];
  claims: Claim[];
  opensAt: string | null;
  closesAt: string | null;
}

const FALLBACK_OPEN = 9;
const FALLBACK_CLOSE = 21;

export function Pulse({ resources, claims, opensAt, closesAt }: Props) {
  const open = opensAt ? Math.floor(istHourOffset(opensAt)) : FALLBACK_OPEN;
  const close = closesAt ? Math.ceil(istHourOffset(closesAt)) : FALLBACK_CLOSE;
  const span = Math.max(close - open, 1);

  const lanes = useMemo(() => {
    const live = claims.filter((c) => occupiesResource(c.status));
    return resources.map((r) => {
      const mine = live.filter((c) => c.resource_id === r.id);
      let booked = 0;
      const blocks = mine.map((c) => {
        const s = Math.max(istHourOffset(c.starts_at), open);
        const e = Math.min(istHourOffset(c.expected_end_at), close);
        const width = Math.max(e - s, 0);
        booked += width;
        return {
          id: c.id,
          left: ((s - open) / span) * 100,
          width: (width / span) * 100,
          held: c.status === "HELD",
          label: `${r.label} · ${c.customer_name}`,
        };
      });
      return { id: r.id, label: r.label, blocks, pct: Math.round((booked / span) * 100) };
    });
  }, [resources, claims, open, close, span]);

  const overall = lanes.length
    ? Math.round(lanes.reduce((s, l) => s + l.pct, 0) / lanes.length)
    : 0;

  const ticks = useMemo(() => {
    const step = span > 10 ? 3 : 2;
    const out: number[] = [];
    for (let h = open; h <= close; h += step) out.push(h);
    if (out[out.length - 1] !== close) out.push(close);
    return out;
  }, [open, close, span]);

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span className={`${styles.title} display`}>The Pulse</span>
        <span className={styles.sub}>
          booked hours across every resource, {pad(open)}:00–{pad(close)}:00
        </span>
        <span className={styles.pct}>{overall}% of capacity sold</span>
      </div>

      {lanes.length === 0 ? (
        <p className={styles.empty}>
          No resources configured for this venue yet.
        </p>
      ) : (
        <div className={styles.lanes}>
          {lanes.map((lane) => (
            <div className={styles.lane} key={lane.id}>
              <div className={styles.laneName}>{lane.label}</div>
              <div className={styles.track}>
                {lane.blocks.map((b) => (
                  <div
                    key={b.id}
                    className={styles.block}
                    data-held={b.held}
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                    title={b.label}
                  />
                ))}
              </div>
              <div className={`${styles.lanePct} num`}>{lane.pct}%</div>
            </div>
          ))}

          <div className={styles.axis}>
            <div className={styles.laneName} />
            <div className={styles.axisTicks}>
              {ticks.map((h) => (
                <span key={h}>{pad(h)}</span>
              ))}
            </div>
            <div className={styles.lanePct} />
          </div>
        </div>
      )}
    </section>
  );
}

function pad(h: number) {
  return String(h).padStart(2, "0");
}
