import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { BookingPatch, Claim, OfflineSource } from "@/lib/api";
import { orderedStations, useSession, zoneLabel } from "@/lib/session";
import { clashingBlocks, clashingClaims, useInvalidateSchedule, useSchedule } from "@/lib/schedule";
import { formatMinutes, istDateKey, istInstant, istTime } from "@/lib/time";
import { Modal } from "./Modal";
import ui from "./ui.module.css";

/* ============================================================
   Add a booking that did not come through the app.

   Designed for a phone call in progress: station, time and a
   name are enough. Everything else is optional. The dialog reads
   the same day's schedule the calendar has cached, so it can say
   "PC 3 is taken, PC 5 and PC 6 are free" before the owner hits
   save — the server's 409 is the backstop, not the first warning.

   With `editing`, the same form edits an existing booking: move it
   (station, day, time), change its length, or correct the details.
   Only what changed is sent. An app booking's customer details
   belong to the customer's XeX account, so they are shown read-only.
   ============================================================ */

const DURATIONS = [30, 60, 90, 120, 180, 240];

const SOURCES: { value: OfflineSource; label: string }[] = [
  { value: "phone", label: "Phone call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "other_platform", label: "Other platform" },
];

export interface BookingDraft {
  resourceId?: string;
  dateKey: string;
  start?: string; // "HH:MM"
}

export function BookingDialog({
  draft,
  editing,
  onClose,
}: {
  draft?: BookingDraft;
  editing?: Claim;
  onClose: () => void;
}) {
  const { venue } = useSession();
  const invalidate = useInvalidateSchedule();
  const isApp = editing?.source === "app";
  const allStations = useMemo(() => orderedStations(venue), [venue]);
  // An app booking can only move between stations of its own bookable —
  // its price was set by that bookable (the API enforces the same rule).
  const stations = useMemo(() => {
    if (!isApp || !editing) return allStations;
    const b = venue.bookables.find((x) => x.id === editing.bookable_id);
    return b ? allStations.filter((st) => b.resource_ids.includes(st.id)) : allStations;
  }, [allStations, isApp, editing, venue.bookables]);

  // Computed once: the form's starting point, and the baseline an edit is diffed against.
  const [initial] = useState(() => initialFrom(editing, draft, venue.bookables, stations[0]?.id ?? ""));
  const [resourceId, setResourceId] = useState(initial.resourceId);
  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [start, setStart] = useState(initial.start);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [source, setSource] = useState<OfflineSource>(initial.source);
  const [sourceDetail, setSourceDetail] = useState(initial.sourceDetail);
  const [amount, setAmount] = useState(initial.amount);
  const [amountTouched, setAmountTouched] = useState(!!editing);
  const [notes, setNotes] = useState(initial.notes);

  const bookable = venue.bookables.find((b) => b.is_active && b.resource_ids.includes(resourceId));
  const buffer = bookable?.buffer_minutes ?? 0;

  const startMs = new Date(istInstant(dateKey, start || "00:00")).getTime();
  const endMs = startMs + minutes * 60_000;
  const blockedEndMs = endMs + buffer * 60_000;

  // List price as a starting point; the owner overrides it for a
  // discount or a regular. Recomputed until they type in the field.
  const listPrice =
    bookable && bookable.pricing_type === "paid"
      ? ((Number(bookable.price) * minutes) / bookable.duration_minutes).toFixed(0)
      : "";
  const shownAmount = amountTouched ? amount : listPrice;

  const day = useSchedule(venue.id, dateKey, dateKey);
  // A booking being edited never conflicts with its own old slot.
  const claims = (day.data?.claims ?? []).filter((c) => c.id !== editing?.id);
  const blocks = day.data?.blocks ?? [];
  const clash = clashingClaims(claims, resourceId, startMs, blockedEndMs);
  const blocked = clashingBlocks(blocks, resourceId, startMs, blockedEndMs);
  const station = stations.find((s) => s.id === resourceId);
  const freeAlternatives =
    clash.length || blocked.length
      ? stations.filter(
          (s) =>
            s.id !== resourceId &&
            s.kind === station?.kind &&
            !clashingClaims(claims, s.id, startMs, blockedEndMs).length &&
            !clashingBlocks(blocks, s.id, startMs, blockedEndMs).length,
        )
      : [];

  const create = useMutation({
    mutationFn: (): Promise<unknown> =>
      editing
        ? api.updateClaim(editing.id, changes())
        : api.createBooking({
        resource_id: resourceId,
        bookable_id: bookable?.id,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(endMs).toISOString(),
        customer_name: name.trim(),
        customer_phone: phone.trim() || undefined,
        source,
        source_detail: sourceDetail.trim() || undefined,
        amount: shownAmount.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onSettled: () => invalidate(),
  });

  /** Only the fields that differ from the booking as loaded. */
  function changes(): BookingPatch {
    const p: BookingPatch = {};
    const startIso = new Date(startMs).toISOString();
    const initialStart = new Date(istInstant(initial.dateKey, initial.start)).toISOString();
    if (resourceId !== initial.resourceId) p.resource_id = resourceId;
    if (startIso !== initialStart) p.starts_at = startIso;
    if (startIso !== initialStart || minutes !== initial.minutes) p.ends_at = new Date(endMs).toISOString();
    if (isApp) return p;
    if (name.trim() !== initial.name) p.customer_name = name.trim();
    if (phone.trim() !== initial.phone) p.customer_phone = phone.trim();
    if (source !== initial.source) p.source = source;
    if (sourceDetail.trim() !== initial.sourceDetail) p.source_detail = sourceDetail.trim();
    if (shownAmount.trim() !== initial.amount && shownAmount.trim() !== "") p.amount = shownAmount.trim();
    if (notes.trim() !== initial.notes) p.notes = notes.trim();
    return p;
  }

  const groups = groupByKind(stations);
  const dirty = !editing || Object.keys(changes()).length > 0;
  const canSave = !!resourceId && !!start && name.trim().length > 0 && dirty && !create.isPending;
  const durations = DURATIONS.includes(minutes) ? DURATIONS : [...DURATIONS, minutes].sort((a, b) => a - b);

  return (
    <Modal
      title={editing ? "Edit booking" : "New booking"}
      sub={editing ? `${editing.customer_name} · ${editing.resource_label}` : "Phone, walk-in or another platform"}
      onClose={onClose}
      footer={
        <>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={`${ui.btn} ${ui.primary}`}
            disabled={!canSave}
            onClick={() => create.mutate()}
            type="button"
          >
            {create.isPending ? "Saving…" : editing ? "Save changes" : "Save booking"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) create.mutate();
        }}
        style={{ display: "contents" }}
      >
        <div className={ui.row}>
          <label className={ui.field}>
            <span className={ui.label}>Station</span>
            <select className={ui.select} value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
              {groups.map(([kind, list]) => (
                <optgroup key={kind} label={zoneLabel(kind)}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Date</span>
            <input className={ui.input} type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} required />
          </label>
        </div>

        <div className={ui.row}>
          <label className={ui.field}>
            <span className={ui.label}>Start</span>
            <input className={ui.input} type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <div className={ui.field}>
            <span className={ui.label}>Ends</span>
            <div className={`${ui.input} num`} style={{ display: "flex", alignItems: "center", background: "var(--track)" }}>
              {start ? istTime(new Date(endMs).toISOString()) : "—"}
              <span style={{ color: "var(--muted-2)", marginLeft: 8, fontSize: 13 }}>{formatMinutes(minutes)}</span>
            </div>
          </div>
        </div>

        <div className={ui.field}>
          <span className={ui.label}>How long</span>
          <div className={ui.segments}>
            {durations.map((d) => (
              <button key={d} type="button" className={ui.segment} aria-pressed={minutes === d} onClick={() => setMinutes(d)}>
                {formatMinutes(d)}
              </button>
            ))}
          </div>
        </div>

        {clash.length || blocked.length ? (
          <div className={ui.error} role="status">
            {station?.label ?? "This station"} is{" "}
            {blocked.length
              ? `blocked${blocked[0].reason ? ` (${blocked[0].reason})` : ""}`
              : `booked ${istTime(clash[0].starts_at)}–${istTime(clash[0].expected_end_at)} by ${clash[0].customer_name || "a customer"}`}
            .
            {freeAlternatives.length ? (
              <div className={ui.segments} style={{ marginTop: 8 }}>
                <span style={{ alignSelf: "center" }}>Free then:</span>
                {freeAlternatives.slice(0, 6).map((s) => (
                  <button key={s.id} type="button" className={ui.segment} onClick={() => setResourceId(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            ) : (
              <> Every {zoneLabel(station?.kind ?? "")} station is taken then.</>
            )}
          </div>
        ) : null}

        {isApp ? (
          <p className={ui.hint} style={{ fontSize: 13 }}>
            Booked in the XeX app by {editing?.customer_name}. You can move it or change its length; the
            customer&apos;s details and payment stay as they are.
          </p>
        ) : (
        <>
        <div className={ui.row}>
          <label className={ui.field}>
            <span className={ui.label}>Customer name</span>
            <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul" maxLength={80} required />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Phone (optional)</span>
            <input className={ui.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98450 12345" inputMode="tel" />
          </label>
        </div>

        <div className={ui.field}>
          <span className={ui.label}>Booked via</span>
          <div className={ui.segments}>
            {SOURCES.map((s) => (
              <button key={s.value} type="button" className={ui.segment} aria-pressed={source === s.value} onClick={() => setSource(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          {source === "other_platform" ? (
            <input
              className={ui.input}
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="Which platform? e.g. Playo, booking #4411"
              maxLength={120}
            />
          ) : null}
        </div>

        <div className={ui.row}>
          <label className={ui.field}>
            <span className={ui.label}>Amount (₹, optional)</span>
            <input
              className={`${ui.input} num`}
              value={shownAmount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value.replace(/[^\d.]/g, ""));
              }}
              inputMode="decimal"
              placeholder="0"
            />
            {listPrice && !amountTouched ? <span className={ui.hint}>List price for {formatMinutes(minutes)}</span> : null}
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Notes (optional)</span>
            <input className={ui.input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Wants the corner PC" maxLength={500} />
          </label>
        </div>
        </>
        )}

        {create.error ? <div className={ui.error}>{describeError(create.error)}</div> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

interface Initial {
  resourceId: string;
  dateKey: string;
  start: string;
  minutes: number;
  name: string;
  phone: string;
  source: OfflineSource;
  sourceDetail: string;
  amount: string;
  notes: string;
}

/** Form state for a new booking (from the draft) or an edit (from the claim).
 *  Session length excludes the bookable's buffer, which the server re-adds. */
function initialFrom(
  editing: Claim | undefined,
  draft: BookingDraft | undefined,
  bookables: { id: string; buffer_minutes: number }[],
  fallbackStation: string,
): Initial {
  if (!editing) {
    return {
      resourceId: draft?.resourceId ?? fallbackStation,
      dateKey: draft?.dateKey ?? istDateKey(),
      start: draft?.start ?? nextQuarterHour(),
      minutes: 60,
      name: "",
      phone: "",
      source: "phone",
      sourceDetail: "",
      amount: "",
      notes: "",
    };
  }
  const buffer = bookables.find((b) => b.id === editing.bookable_id)?.buffer_minutes ?? 0;
  const mins =
    Math.round((new Date(editing.expected_end_at).getTime() - new Date(editing.starts_at).getTime()) / 60_000) - buffer;
  return {
    resourceId: editing.resource_id,
    dateKey: istDateKey(new Date(editing.starts_at)),
    start: istTime(editing.starts_at),
    minutes: Math.max(mins, 15),
    name: editing.customer_name,
    // Shown as the 10-digit number people read out; the API re-adds the 91.
    phone: /^91\d{10}$/.test(editing.customer_phone) ? editing.customer_phone.slice(2) : editing.customer_phone,
    source: editing.source === "app" ? "phone" : editing.source,
    sourceDetail: editing.source_detail ?? "",
    amount: editing.amount && Number(editing.amount) > 0 ? String(Number(editing.amount)) : "",
    notes: editing.notes ?? "",
  };
}

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    const c = err.body.conflicts?.[0];
    if (c) {
      return `${c.resource_label} was just booked ${istTime(c.starts_at)}–${istTime(c.expected_end_at)}${c.customer_name ? ` by ${c.customer_name}` : ""}. Pick another time or station.`;
    }
    if (err.body.code === "blocked") return "That station is blocked for part of this time.";
  }
  return err instanceof Error ? err.message : "Could not save the booking.";
}

function groupByKind<T extends { kind: string }>(list: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const s of list) out.set(s.kind, [...(out.get(s.kind) ?? []), s]);
  return [...out.entries()];
}

/** The next quarter hour from now, as "HH:MM" in IST. */
function nextQuarterHour(): string {
  const ms = Math.ceil(Date.now() / 900_000) * 900_000;
  return istTime(new Date(ms).toISOString());
}
