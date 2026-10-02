import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError, setAuthToken } from "@/lib/api";
import ui from "@/components/ui.module.css";
import styles from "./Login.module.css";

/* The owner signs in with the same phone + OTP as the XEX app.
   There is no separate VenueOS account: owning the venue listing
   is what makes an account a venue account. */
export function Login() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: () => api.sendOtp(phone),
    onSuccess: () => setSent(true),
  });
  const verify = useMutation({
    mutationFn: () => api.verifyOtp(phone, otp.trim()),
    onSuccess: (r) => setAuthToken(r.token),
  });

  const digits = phone.replace(/\D/g, "");
  const error = sent ? verify.error : send.error;

  return (
    <div className={styles.page}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          if (!sent) send.mutate();
          else verify.mutate();
        }}
      >
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true" />
          <div>
            <b>XEX</b> <span>VenueOS</span>
          </div>
        </div>
        <h1 className={`${styles.title} display`}>{sent ? "Enter the code" : "Sign in"}</h1>
        <p className={styles.sub}>
          {sent ? `We sent a code to ${phone}.` : "Use the phone number your venue is registered with on XEX."}
        </p>

        {!sent ? (
          <label className={ui.field}>
            <span className={ui.label}>Phone number</span>
            <input
              className={ui.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98450 12345"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
            />
          </label>
        ) : (
          <label className={ui.field}>
            <span className={ui.label}>One-time code</span>
            <input
              className={`${ui.input} num`}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
          </label>
        )}

        {error ? <div className={ui.error}>{describe(error)}</div> : null}

        <button
          className={`${ui.btn} ${ui.primary}`}
          style={{ height: 42 }}
          disabled={sent ? otp.length < 4 || verify.isPending : digits.length < 10 || send.isPending}
          type="submit"
        >
          {sent ? (verify.isPending ? "Checking…" : "Sign in") : send.isPending ? "Sending…" : "Send code"}
        </button>

        {sent ? (
          <button
            className={styles.link}
            type="button"
            onClick={() => {
              setSent(false);
              setOtp("");
              verify.reset();
            }}
          >
            Use a different number
          </button>
        ) : null}
      </form>
    </div>
  );
}

function describe(err: Error): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "This number has no XEX account. Ask the XEX team to set up your venue.";
    if (err.status === 401) return "That code is not right. Check it and try again.";
    if (err.status === 429) return "Too many tries. Wait a minute and try again.";
  }
  return err.message;
}
