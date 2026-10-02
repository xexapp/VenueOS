import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Claim, PaymentMethod } from "@/lib/api";
import { useInvalidateSchedule } from "@/lib/schedule";
import { methodLabel, payState } from "@/lib/status";
import { istTime } from "@/lib/time";
import { Modal } from "./Modal";
import ui from "./ui.module.css";
import styles from "./Payment.module.css";

/* ============================================================
   Recording money at the desk. The common case is one tap: the
   amount is already there (list price, or whatever was typed at
   booking), so the desk just says how it came in — Cash, UPI, Card.
   The amount stays editable for the discount-at-the-counter case.

   App bookings show "Paid online" and nothing to press: that money
   went through Cashfree and must not be counted twice.
   ============================================================ */

const METHODS: PaymentMethod[] = ["cash", "upi", "card"];

export function PaymentBox({ claim, onDone }: { claim: Claim; onDone?: () => void }) {
  const invalidate = useInvalidateSchedule();
  const state = payState(claim);
  const [amount, setAmount] = useState(claim.amount && Number(claim.amount) > 0 ? String(Number(claim.amount)) : "");

  const record = useMutation({
    mutationFn: (m: PaymentMethod) => api.recordPayment(claim.id, m, amount.trim() || undefined),
    onSuccess: () => {
      invalidate();
      onDone?.();
    },
  });
  const undo = useMutation({ mutationFn: () => api.clearPayment(claim.id), onSuccess: () => invalidate() });
  const error = record.error ?? undo.error;

  if (state === "online") {
    return (
      <div className={styles.box} data-state="paid">
        <span className={styles.status}>Paid online</span>
        <span className="num">{rupees(claim.amount)}</span>
        <span className={styles.minor}>through the XeX app</span>
      </div>
    );
  }

  if (claim.source === "app") {
    return (
      <div className={styles.box}>
        <span className={styles.minor}>Free booking — nothing to collect</span>
      </div>
    );
  }

  if (state === "paid") {
    return (
      <div className={styles.box} data-state="paid">
        <span className={styles.status}>Paid · {methodLabel(claim.payment_method ?? "other")}</span>
        <span className="num">{rupees(claim.amount)}</span>
        {claim.paid_at ? <span className={styles.minor}>at {istTime(claim.paid_at)}</span> : null}
        <button className={styles.undo} type="button" disabled={undo.isPending} onClick={() => undo.mutate()}>
          Undo
        </button>
        {error ? <div className={ui.error} style={{ width: "100%" }}>{error.message}</div> : null}
      </div>
    );
  }

  const busy = record.isPending;
  return (
    <div className={styles.box} data-state="unpaid">
      <span className={styles.status}>{state === "unpaid" ? "Unpaid" : "No amount recorded"}</span>
      <label className={styles.amount}>
        <span>₹</span>
        <input
          className={`${ui.input} num`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          placeholder="0"
          aria-label="Amount collected"
        />
      </label>
      <div className={styles.methods}>
        {METHODS.map((m) => (
          <button
            key={m}
            type="button"
            className={`${ui.btn} ${ui.primary}`}
            disabled={busy || !amount}
            onClick={() => record.mutate(m)}
          >
            {methodLabel(m)}
          </button>
        ))}
        <button type="button" className={`${ui.btn} ${ui.ghost}`} disabled={busy || !amount} onClick={() => record.mutate("other")}>
          Other
        </button>
      </div>
      {error ? <div className={ui.error} style={{ width: "100%" }}>{error.message}</div> : null}
    </div>
  );
}

/** "Collect ₹200 from Kiran" — opened after ending a session, or from a
 *  "Needs you" / cash-up row. Closing it is "later": nothing is lost, the
 *  booking just stays unpaid and keeps showing up as owed. */
export function CollectDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  return (
    <Modal
      title={`Collect ${rupees(claim.amount)}`}
      sub={`${claim.customer_name || "Customer"} · ${claim.resource_label} · ${istTime(claim.starts_at)}–${istTime(claim.expected_end_at)}`}
      onClose={onClose}
      footer={
        <button className={`${ui.btn} ${ui.ghost}`} onClick={onClose} type="button">
          Later
        </button>
      }
    >
      <PaymentBox claim={claim} onDone={onClose} />
    </Modal>
  );
}

export function rupees(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n > 0 ? `₹${Math.round(n).toLocaleString("en-IN")}` : "₹0";
}
