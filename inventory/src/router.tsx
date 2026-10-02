import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "./app/AppShell";
import { Dashboard } from "./routes/Dashboard";
import { Calendar } from "./routes/Calendar";
import { Bookings } from "./routes/Bookings";
import { Revenue } from "./routes/Revenue";
import { Floor } from "./routes/Floor";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

// ?date=YYYY-MM-DD keeps a day linkable and survives a reload.
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  component: Calendar,
  validateSearch: (s: Record<string, unknown>): { date?: string } => ({
    date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
  }),
});

const bookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bookings",
  component: Bookings,
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
});

const revenueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/revenue",
  component: Revenue,
});

const floorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/floor",
  component: Floor,
});

const routeTree = rootRoute.addChildren([indexRoute, floorRoute, calendarRoute, bookingsRoute, revenueRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
