/* ============================================================
   The dashboard is single-timezone by design. The backend stores
   timestamptz in UTC; every operator is in Asia/Kolkata. There is
   no timezone switcher and there should not be one.
   ============================================================ */

export const IST = "Asia/Kolkata";

/** YYYY-MM-DD for a Date, evaluated in IST rather than the browser's zone. */
export function istDateKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "18:00" */
export function istTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "Monday, 9 August" */
export function istLongDate(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** Fractional hours since IST midnight — the Pulse's x-axis unit. */
export function istHourOffset(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get("hour") + get("minute") / 60;
}

export function shiftDay(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return istDateKey(d);
}

/** Milliseconds for IST midnight at the start of a date key. */
export function istMidnight(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00+05:30`).getTime();
}

/** Hours from the start of `dateKey` to `iso`. Unlike istHourOffset this
 *  does not wrap, so a session running past midnight lands at 25.5, not 1.5. */
export function hoursIntoDay(dateKey: string, iso: string): number {
  return (new Date(iso).getTime() - istMidnight(dateKey)) / 3_600_000;
}

/** ISO instant for a wall-clock "HH:MM" on an IST date. */
export function istInstant(dateKey: string, hhmm: string): string {
  return new Date(`${dateKey}T${hhmm}:00+05:30`).toISOString();
}

/** "Sat 26 Sep" */
export function istShortDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateKey}T12:00:00+05:30`));
}

/** "Sat 26 Sep, 18:00" */
export function istDateTime(iso: string): string {
  return `${istShortDate(istDateKey(new Date(iso)))}, ${istTime(iso)}`;
}

/** "1h 30m", "45m", "2h" */
export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "HH:MM" from fractional hours since midnight; 24+ wraps for display. */
export function hhmm(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Monday of the week containing dateKey. */
export function weekStart(dateKey: string): string {
  // A date key's weekday does not depend on a timezone; read it in UTC.
  const dow = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return shiftDay(dateKey, -((dow + 6) % 7));
}
