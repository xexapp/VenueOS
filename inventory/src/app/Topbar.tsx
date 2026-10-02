import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ProfileMenu } from "./ProfileMenu";
import styles from "./Topbar.module.css";

export function Topbar({ here }: { here: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

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
        <ProfileMenu />
      </div>
    </header>
  );
}
