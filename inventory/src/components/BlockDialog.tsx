import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { orderedStations, useSession } from "@/lib/session";
import { useInvalidateSchedule } from "@/lib/schedule";
import { istInstant, istTime } from "@/lib/time";
import { Modal } from "./Modal";
import ui from "./ui.module.css";

/* Take a station (or the whole venue) out of service: a broken PC,
   a private event, a staff break. Blocked time disappears from the
   app's slot list and VenueOS refuses bookings on it. */
export function BlockDialog({
  dateKey,
  resourceId,
  start,
  onClose,
}: {
  dateKey: string;
  resourceId?: string;
  start?: string;
  onClose: () => void;
}) {
  const { venue } = useSession();
  const stations = useMemo(() => orderedStations(venue), [venue]);
  const invalidate = useInvalidateSchedule();

  const [target, setTarget] = useState(resourceId ?? "");
  const [fromDate, setFromDate] = useState(dateKey);
  const [from, setFrom] = useState(start ?? "12:00");
  const [toDate, setToDate] = useState(dateKey);
  const [to, setTo] = useState(start ? addHour(start) : "14:00");
  const [reason, setReason] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createBlock(venue.id, {
        resource_id: target || undefined,
        starts_at: istInstant(fromDate, from),
        ends_at: istInstant(toDate, to),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal
      title="Block time"
      sub="No bookings from the app or the desk"
      onClose={onClose}
      footer={
        <>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
            Cancel
          </button>
          <button className={`${ui.btn} ${ui.primary}`} disabled={create.isPending} onClick={() => create.mutate()} type="button">
            {create.isPending ? "Saving…" : "Block"}
          </button>
        </>
      }
    >
      <label className={ui.field}>
        <span className={ui.label}>What</span>
        <select className={ui.select} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Whole venue</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className={ui.row}>
        <label className={ui.field}>
          <span className={ui.label}>From</span>
          <input className={ui.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <input className={ui.input} type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Until</span>
          <input className={ui.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <input className={ui.input} type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label className={ui.field}>
        <span className={ui.label}>Reason (optional)</span>
        <input className={ui.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="GPU fan broken" maxLength={200} />
      </label>
      {create.error ? <div className={ui.error}>{describe(create.error)}</div> : null}
    </Modal>
  );
}

function describe(err: Error): string {
  if (err instanceof ApiError && err.status === 409 && err.body.conflicts?.length) {
    const list = err.body.conflicts
      .slice(0, 3)
      .map((c) => `${c.resource_label} ${istTime(c.starts_at)} (${c.customer_name || "customer"})`)
      .join(", ");
    return `There are bookings in that window: ${list}. Move them first, or block a shorter window.`;
  }
  return err.message;
}

function addHour(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
