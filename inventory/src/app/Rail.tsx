import { Link, useRouterState } from "@tanstack/react-router";
import { signOut, useSession } from "@/lib/session";
import styles from "./Rail.module.css";

/* Today's work, the week around it, the ledger behind it, and
   what it all earned. */
const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/calendar", label: "Calendar" },
  { to: "/bookings", label: "Bookings" },
  { to: "/revenue", label: "Revenue" },
] as const;

export function Rail() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { venue } = useSession();

  return (
    <aside className={styles.rail}>
      <div className={styles.brand}>
        <div className={styles.mark} aria-hidden="true" />
        <div className={styles.wordmark}>
          <b>XEX</b>
          <span>VenueOS</span>
        </div>
      </div>

      <nav className={styles.nav}>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={styles.item} data-active={pathname === n.to}>
            {n.label}
          </Link>
        ))}
      </nav>

      <div className={styles.foot}>
        <div className={styles.footLabel}>Venue</div>
        <div className={styles.footValue}>{venue.name}</div>
        {!venue.is_active ? <div className={styles.footNote}>Hidden in the app</div> : null}
        <button className={styles.collapse} onClick={signOut} type="button">
          Sign out
        </button>
      </div>
    </aside>
  );
}
