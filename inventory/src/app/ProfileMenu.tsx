import { useEffect, useRef, useState } from "react";
import type { Venue } from "@/lib/api";
import { signOut, useSession, zoneLabel } from "@/lib/session";
import styles from "./ProfileMenu.module.css";

/* ============================================================
   The owner's own account, opened from the avatar in the top bar.

   Deliberately small: who they are (only what they gave us — name,
   phone, and email if they added one) and the venue at a glance
   (address, stations, hours, whether it is live in the app). No
   booking numbers — the dashboard already has those and repeating
   them here would only be noise.

   Also the one place to sign out on a phone, where the side rail
   (and its Sign out) collapses into the bottom tab bar.
   ============================================================ */

export function ProfileMenu() {
  const { me, venue } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = me?.full_name?.trim() || "Venue owner";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·";

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Your profile"
      >
        <span className={styles.avatar}>{initials}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Your profile">
          <div className={styles.head}>
            <span className={`${styles.avatar} ${styles.big}`}>{initials}</span>
            <div className={styles.who}>
              <b>{name}</b>
              <span>Owner · {venue.name}</span>
            </div>
          </div>

          <Section title="Your details">
            {me?.phone_number ? <Row label="Phone" value={formatPhone(me.phone_number)} /> : null}
            {me?.email ? <Row label="Email" value={me.email} /> : null}
          </Section>

          <Section title="Venue">
            {venue.address ? <Row label="Address" value={venue.address} /> : null}
            <Row label="Stations" value={stationsSummary(venue)} />
            <Row label="Hours" value={hoursSummary(venue)} />
            <Row
              label="In the XEX app"
              value={venue.is_active ? "Live — customers can book" : "Hidden — not bookable in the app yet"}
            />
          </Section>

          <button type="button" className={styles.signOut} onClick={signOut}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionTitle} eyebrow`}>{title}</div>
      <dl className={styles.rows}>{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** "8 Gaming PCs · 3 PlayStation" */
function stationsSummary(v: Venue): string {
  const counts = new Map<string, number>();
  for (const r of v.resources) if (r.is_active) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} ${zoneLabel(k)}`).join(" · ") || "None set up";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Daily 11:00–23:00", or "Mon–Fri 11:00–23:00 · Sat, Sun 10:00–24:00",
 *  or "Not set" — grouped so the same hours never repeat per day. */
function hoursSummary(v: Venue): string {
  if (!v.hours.length) return "Not set";
  const byWindow = new Map<string, number[]>();
  for (const h of v.hours) {
    const key = `${h.opens_at}–${h.closes_at}`;
    byWindow.set(key, [...(byWindow.get(key) ?? []), h.day_of_week]);
  }
  if (byWindow.size === 1 && v.hours.length === 7) return `Daily ${[...byWindow.keys()][0]}`;
  return [...byWindow.entries()]
    .map(([w, days]) => `${[...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(", ")} ${w}`)
    .join(" · ");
}

/** "919172455879" -> "+91 91724 55879" */
function formatPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : p;
}
