import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Block, Claim } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useInvalidateSchedule } from "@/lib/schedule";
import { bookingView, isRunning, sourceLabel, TONE_STYLE } from "@/lib/status";
import { formatMinutes, istDateTime, istTime } from "@/lib/time";
import { BookingDialog } from "./BookingDialog";
import { PaymentBox } from "./Payment";
import { Modal } from "./Modal";
import ui from "./ui.module.css";

/* One booking and everything the owner can do to it: decide an app
   request, end a running session, extend it, move/edit it, or cancel.

   Extend is the gaming-café case — "one more hour?" — so it is two
   taps in the dialog rather than a trip through the edit form. */
export function ClaimDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { venue } = useSession();
  const invalidate = useInvalidateSchedule();
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const done = {
    onSuccess: () => {
      invalidate();
      onClose();
    },
  };

  const buffer = venue.bookables.find((b) => b.id === claim.bookable_id)?.buffer_minutes ?? 0;
  const sessionEnd = new Date(claim.expected_end_at).getTime() - buffer * 60_000;

  const accept = useMutation({ mutationFn: () => api.acceptOrder(claim.order_id), ...done });
  const reject = useMutation({ mutationFn: () => api.rejectOrder(claim.order_id), ...done });
  const release = useMutation({ mutationFn: () => api.releaseClaim(claim.id), ...done });
  const extend = useMutation({
    mutationFn: (mins: number) =>
      api.updateClaim(claim.id, { ends_at: new Date(sessionEnd + mins * 60_000).toISOString() }),
    ...done,
  });
  const cancel = useMutation({ mutationFn: () => api.cancelClaim(claim.id, reason.trim() || undefined), ...done });
  const busy = accept.isPending || reject.isPending || release.isPending || extend.isPending || cancel.isPending;
  const error = accept.error ?? reject.error ?? release.error ?? extend.error ?? cancel.error;

  const pending = claim.order_status === "PENDING_APPROVAL";
  // Mirrors the API's rule: settled, holding its station, not ended early.
  const editable = claim.status === "CONFIRMED" && claim.order_status === "CONFIRMED" && !claim.released_at;
  const finished = new Date(claim.expected_end_at).getTime() <= Date.now();
  const running = isRunning(claim) && editable;
  const paidOnline = claim.source === "app" && claim.is_paid && Number(claim.amount ?? 0) > 0;
  const view = bookingView(claim);
  const tone = TONE_STYLE[view.tone];
  const mins = (new Date(claim.expected_end_at).getTime() - new Date(claim.starts_at).getTime()) / 60_000;

  if (editing) return <BookingDialog editing={claim} onClose={onClose} />;

  const footer = pending ? (
    <>
      <button className={`${ui.btn} ${ui.danger}`} disabled={busy} onClick={() => reject.mutate()} type="button">
        Decline
      </button>
      <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => accept.mutate()} type="button">
        Approve
      </button>
    </>
  ) : confirmCancel ? (
    <>
      <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={() => setConfirmCancel(false)} type="button">
        Keep booking
      </button>
      <button className={`${ui.btn} ${ui.danger}`} disabled={busy} onClick={() => cancel.mutate()} type="button">
        {cancel.isPending ? "Cancelling…" : "Yes, cancel it"}
      </button>
    </>
  ) : editable ? (
    <>
      {!finished ? (
        <button
          className={`${ui.btn} ${ui.danger}`}
          style={{ marginRight: "auto" }}
          disabled={busy || paidOnline}
          title={paidOnline ? "Paid online: needs a refund, which VenueOS cannot issue yet" : undefined}
          onClick={() => setConfirmCancel(true)}
          type="button"
        >
          Cancel booking
        </button>
      ) : null}
      <button className={`${ui.btn} ${ui.ghost}`} disabled={busy} onClick={() => setEditing(true)} type="button">
        Edit / move
      </button>
      {running ? (
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy} onClick={() => release.mutate()} type="button">
          {release.isPending ? "Ending…" : "End session now"}
        </button>
      ) : null}
    </>
  ) : (
    <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
      Close
    </button>
  );

  return (
    <Modal title={claim.customer_name || "Customer"} sub={`${claim.resource_label} · ${claim.bookable_title}`} onClose={onClose} footer={footer}>
      <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 10, fontSize: 14 }}>
        <Dt>Status</Dt>
        <dd>
          <span className={ui.chip} style={{ color: tone.color, background: tone.background }}>
            {view.label}
          </span>
          {claim.released_at && claim.status === "CONFIRMED" ? (
            <span style={{ color: "var(--muted)", marginLeft: 8, fontSize: 13 }}>ended early at {istTime(claim.released_at)}</span>
          ) : null}
        </dd>
        <Dt>When</Dt>
        <dd className="num">
          {istDateTime(claim.starts_at)}–{istTime(claim.expected_end_at)}{" "}
          <span style={{ color: "var(--muted-2)" }}>({formatMinutes(mins)})</span>
        </dd>
        {editable && !confirmCancel ? (
          <>
            <Dt>Extend</Dt>
            <dd className={ui.segments}>
              {[30, 60, 120].map((m) => (
                <button key={m} type="button" className={ui.segment} disabled={busy} onClick={() => extend.mutate(m)}>
                  +{formatMinutes(m)}
                </button>
              ))}
            </dd>
          </>
        ) : null}
        <Dt>Booked via</Dt>
        <dd>
          {sourceLabel(claim.source)}
          {claim.source_detail ? <span style={{ color: "var(--muted)" }}> · {claim.source_detail}</span> : null}
        </dd>
        <Dt>Phone</Dt>
        <dd>
          {claim.customer_phone ? (
            <a href={`tel:+${claim.customer_phone.replace(/\D/g, "")}`} style={{ color: "var(--accent-deep)", display: "inline-block", padding: "10px 0", margin: "-10px 0" }} className="num">
              {formatPhone(claim.customer_phone)}
            </a>
          ) : (
            <span style={{ color: "var(--muted-2)" }}>Not given</span>
          )}
        </dd>
        {claim.status !== "CONFIRMED" || claim.order_status !== "CONFIRMED" ? (
          <>
            <Dt>Amount</Dt>
            <dd className="num">{claim.amount && Number(claim.amount) > 0 ? `₹${Math.round(Number(claim.amount)).toLocaleString("en-IN")}` : "—"}</dd>
          </>
        ) : null}
        {claim.notes ? (
          <>
            <Dt>Notes</Dt>
            <dd>{claim.notes}</dd>
          </>
        ) : null}
        {pending && claim.approval_expires_at ? (
          <>
            <Dt>Decide by</Dt>
            <dd>{istDateTime(claim.approval_expires_at)} — it expires on its own after that</dd>
          </>
        ) : null}
      </dl>

      {claim.status === "CONFIRMED" && claim.order_status === "CONFIRMED" && !confirmCancel ? <PaymentBox claim={claim} /> : null}

      {confirmCancel ? (
        <label className={ui.field}>
          <span className={ui.label}>Cancel {claim.customer_name}&apos;s booking? The station frees up straight away.</span>
          <input
            className={ui.input}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional), e.g. no-show"
            maxLength={200}
            autoFocus
          />
        </label>
      ) : null}
      {editable && paidOnline && !confirmCancel ? (
        <p className={ui.hint}>Paid online, so it can be moved or extended but not cancelled here yet (it needs a refund).</p>
      ) : null}
      {error ? <div className={ui.error}>{describe(error)}</div> : null}
    </Modal>
  );
}

function describe(err: Error): string {
  if (err instanceof ApiError && err.status === 409) {
    const c = err.body.conflicts?.[0];
    if (c) return `Can't extend: ${c.resource_label} is booked from ${istTime(c.starts_at)}${c.customer_name ? ` by ${c.customer_name}` : ""}. Move this booking to a free station instead.`;
    if (err.body.code === "blocked") return "Can't extend into blocked time.";
  }
  return err.message;
}

export function BlockInfoDialog({ block, onClose }: { block: Block; onClose: () => void }) {
  const { venue } = useSession();
  const invalidate = useInvalidateSchedule();
  const remove = useMutation({
    mutationFn: () => api.deleteBlock(block.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const station = block.resource_id ? venue.resources.find((r) => r.id === block.resource_id)?.label : "Whole venue";

  return (
    <Modal
      title="Blocked"
      sub={station ?? "Station"}
      onClose={onClose}
      footer={
        <>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
            Keep
          </button>
          <button className={`${ui.btn} ${ui.danger}`} disabled={remove.isPending} onClick={() => remove.mutate()} type="button">
            {remove.isPending ? "Removing…" : "Remove block"}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14 }} className="num">
        {istDateTime(block.starts_at)} – {istDateTime(block.ends_at)}
      </p>
      {block.reason ? <p style={{ fontSize: 14, color: "var(--muted)" }}>{block.reason}</p> : null}
      {remove.error ? <div className={ui.error}>{remove.error.message}</div> : null}
    </Modal>
  );
}

function Dt({ children }: { children: string }) {
  return <dt style={{ color: "var(--muted)", fontSize: 13 }}>{children}</dt>;
}

/** "919845012345" -> "+91 98450 12345" */
export function formatPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return p;
}
