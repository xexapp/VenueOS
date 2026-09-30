import { Outlet, useRouterState } from "@tanstack/react-router";
import { SessionProvider, signOut, useAuthToken, useMeQuery, useVenuesQuery } from "@/lib/session";
import { EmptyState, ErrorState, Panel } from "@/components/Panel";
import { Login } from "@/routes/Login";
import ui from "@/components/ui.module.css";
import { Rail } from "./Rail";
import { Topbar } from "./Topbar";
import styles from "./AppShell.module.css";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/bookings": "Bookings",
  "/calendar": "Calendar",
  "/revenue": "Revenue",
};

export function AppShell() {
  const token = useAuthToken();
  if (!token) return <Login />;
  return <SignedIn />;
}

function SignedIn() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const venues = useVenuesQuery();
  const me = useMeQuery();

  if (venues.isPending) return <div className={styles.boot} aria-busy="true" />;

  if (venues.isError) {
    return (
      <Centered>
        <ErrorState body={venues.error.message} onRetry={() => venues.refetch()} />
      </Centered>
    );
  }

  // A valid XeX account that owns no venue: the owner signed in with the
  // wrong number, or the venue has not been set up yet.
  const venue = venues.data.venues[0];
  if (!venue) {
    return (
      <Centered>
        <EmptyState
          title="No venue on this account"
          body={`${me.data?.full_name ?? "This account"} is signed in, but does not own a venue on XeX. Sign in with the venue's number, or ask the XeX team to link it.`}
        />
        <div style={{ padding: "0 24px 24px" }}>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <SessionProvider venue={venue} me={me.data}>
      <div className={styles.shell}>
        <Rail />
        <div className={styles.main}>
          <Topbar here={TITLES[pathname] ?? "Dashboard"} />
          <main className={styles.content}>
            <Outlet />
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.center}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <Panel title="VenueOS">{children}</Panel>
      </div>
    </div>
  );
}
