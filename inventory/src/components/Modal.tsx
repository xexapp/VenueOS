import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import ui from "./ui.module.css";

/* A plain overlay rather than <dialog>: it has to stack over the
   calendar's sticky headers, and Escape/backdrop-close are the only
   behaviours the desk needs. Focus moves into the modal on open so
   a keyboard user lands on the first field. */
export function Modal({
  title,
  sub,
  onClose,
  children,
  footer,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={ui.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={ui.modal} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className={ui.modalHead}>
          <h2 className={`${ui.modalTitle} display`}>{title}</h2>
          {sub ? <span className={ui.modalSub}>{sub}</span> : null}
          <button className={ui.close} onClick={onClose} type="button" aria-label="Close" data-close>
            ×
          </button>
        </div>
        <div className={ui.modalBody}>{children}</div>
        {footer ? <div className={ui.modalFoot}>{footer}</div> : null}
      </div>
    </div>
  );
}
