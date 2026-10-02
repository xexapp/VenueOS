import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export function Panel({
  title,
  aside,
  action,
  children,
}: {
  title: string;
  aside?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <h2 className={`${styles.title} display`}>{title}</h2>
        {aside ? <span className={styles.aside}>{aside}</span> : null}
        {action ? <span className={styles.action}>{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

/* Empty, loading and error are first-class here rather than an
   afterthought — an empty Tuesday at the salon is the common case,
   not an edge case. */
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.state}>
      <div className={`${styles.stateTitle} display`}>{title}</div>
      <p className={styles.stateBody}>{body}</p>
    </div>
  );
}

export function ErrorState({
  body,
  onRetry,
}: {
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.state}>
      <div className={`${styles.stateTitle} display`}>Could not load this</div>
      <p className={styles.stateBody}>{body}</p>
      {onRetry ? (
        <button className={styles.retry} onClick={onRetry} type="button">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className={styles.body}
      style={{ display: "flex", flexDirection: "column", gap: 18, padding: "14px 24px 24px" }}
      aria-busy="true"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={styles.skelRow}
          style={{ width: `${88 - i * 9}%`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  );
}
