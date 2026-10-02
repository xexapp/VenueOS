import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import styles from "./Topbar.module.css";

export function Topbar({ here }: { here: string }) {
  const { me } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const name = me?.full_name ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  return (
    <header className={styles.bar}>
      <div className={styles.crumbs}>
        VenueOS
        <span className={styles.sep}>/</span>
        <span className={styles.here}>{here}</span>
      </div>
      <div className={styles.right}>
        {/* Searching jumps to the ledger, which owns the filtering. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ to: "/bookings", search: { q: q.trim() || undefined } });
          }}
        >
          <input
            className={styles.search}
            placeholder="Search bookings, customers…"
            aria-label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <div className={styles.who}>
          <div className={styles.avatar}>{initials || "·"}</div>
          <span className={styles.name}>{name}</span>
        </div>
      </div>
    </header>
  );
}
