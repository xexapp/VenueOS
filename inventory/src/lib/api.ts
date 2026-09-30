/* ============================================================
   API client for the Go/Gin backend.

   Host routes live under /api/v1/host/* and are authorized by
   ownership: the caller must own the listing (no role check).
   In dev, Vite proxies /api to localhost:8080. In production,
   VITE_API_BASE points at the deployed API, which must list the
   dashboard origin in CORS_ALLOWED_ORIGINS.
   ============================================================ */

const BASE = import.meta.env.VITE_API_BASE ?? "";

/** Backend order lifecycle. Kept exhaustive on purpose — a new
 *  state added server-side should break the build here, not fall
 *  through to a grey badge in the UI. */
export type OrderStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "HELD"
  | "AWAITING_PAYMENT"
  | "CONFIRMED"
  | "WAITLISTED"
  | "REJECTED"
  | "EXPIRED"
  | "FAILED"
  | "CANCELLED";

/** resource_claims.status — the CHECK constraint allows exactly these. */
export type ClaimStatus = "HELD" | "CONFIRMED" | "EXPIRED" | "CANCELLED";

/** orders.source — orders_source_check. */
export type Source = "app" | "phone" | "walk_in" | "other_platform";
export type OfflineSource = Exclude<Source, "app">;

export interface Resource {
  id: string;
  kind: string; // "pc" | "console" for the trial venue
  label: string;
  metadata: { position?: number; zone?: string } & Record<string, unknown>;
  is_active: boolean;
}

export interface Bookable {
  id: string;
  title: string;
  duration_minutes: number;
  min_units: number;
  max_units: number;
  buffer_minutes: number;
  pricing_type: "free" | "paid";
  price: string; // decimal as string
  currency: string;
  admission_mode: "instant" | "approval";
  is_active: boolean;
  resource_ids: string[];
}

export interface HoursRule {
  day_of_week: number; // 0 = Sunday
  opens_at: string; // "11:00"
  closes_at: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  is_active: boolean;
  resources: Resource[];
  bookables: Bookable[];
  hours: HoursRule[];
}

export interface Claim {
  id: string;
  order_id: string;
  bookable_id: string;
  bookable_title: string;
  resource_id: string;
  resource_label: string;
  starts_at: string; // RFC3339, UTC
  expected_end_at: string; // includes the bookable's buffer
  released_at: string | null;
  status: ClaimStatus;
  order_status: OrderStatus;
  source: Source;
  source_detail: string | null;
  customer_name: string;
  customer_phone: string;
  amount: string | null;
  currency: string;
  is_paid: boolean;
  notes: string | null;
  approval_expires_at: string | null;
  created_at: string;
}

export interface Block {
  id: string;
  resource_id: string | null; // null = whole venue
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface Day {
  date: string; // YYYY-MM-DD in venue time
  opens_at: string | null;
  closes_at: string | null;
}

export interface Schedule {
  listing_id: string;
  timezone: string;
  from: string;
  to: string;
  days: Day[];
  claims: Claim[];
  blocks: Block[];
}

export interface Conflict {
  claim_id: string;
  resource_id: string;
  resource_label: string;
  starts_at: string;
  expected_end_at: string;
  customer_name: string;
}

export interface Me {
  id: string;
  full_name: string;
  phone_number: string;
}

export interface NewBooking {
  resource_id: string;
  bookable_id?: string;
  starts_at: string;
  ends_at: string;
  customer_name: string;
  customer_phone?: string;
  source: OfflineSource;
  source_detail?: string;
  amount?: string;
  notes?: string;
}

/** PATCH /host/claims/:id — send only what changes. Extending is just a
 *  new ends_at. Detail fields are rejected on app bookings. */
export interface BookingPatch {
  resource_id?: string;
  starts_at?: string;
  ends_at?: string;
  customer_name?: string;
  customer_phone?: string;
  source?: OfflineSource;
  source_detail?: string;
  amount?: string;
  notes?: string;
}

export interface RevenueDay {
  date: string;
  app: string;
  desk: string;
  bookings: number;
  hours: number;
}

export interface Revenue {
  from: string;
  to: string;
  currency: string;
  total: string;
  bookings: number;
  hours: number;
  unpriced: number;
  open_hours: number;
  by_day: RevenueDay[];
  by_source: { source: Source; amount: string; bookings: number }[];
  by_station: {
    resource_id: string;
    label: string;
    kind: string;
    amount: string;
    bookings: number;
    hours: number;
    utilisation: number;
  }[];
  by_start_hour: { hour: number; bookings: number }[];
}

export interface NewBlock {
  resource_id?: string;
  starts_at: string;
  ends_at: string;
  reason?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: {
      code?: string;
      conflicts?: Conflict[];
      blocks?: Block[];
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/* ---- token --------------------------------------------------
   Kept in localStorage so the front desk stays signed in across
   reloads; the JWT itself lasts 30 days. Every access is wrapped
   because storage can throw in private windows. */

const TOKEN_KEY = "venueos.token";
let authToken: string | null = readToken();
const listeners = new Set<(token: string | null) => void>();

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only sign-in */
  }
  listeners.forEach((l) => l(token));
}

export function onAuthChange(l: (token: string | null) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check the connection.");
  }

  if (!res.ok) {
    let message = res.statusText;
    let body: ApiError["body"] = {};
    try {
      const json = (await res.json()) as { error?: string } & ApiError["body"];
      if (json.error) message = json.error;
      body = json;
    } catch {
      /* non-JSON error body; keep statusText */
    }
    // An expired or revoked token signs the desk out rather than
    // leaving every panel in an error state.
    if (res.status === 401 && authToken) setAuthToken(null);
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  // auth
  sendOtp: (phone: string) => post<{ status: string }>("/api/v1/auth/otp/send", { phone }),
  verifyOtp: (phone: string, otp: string) =>
    post<{ token: string }>("/api/v1/auth/login/verify", { phone, otp }),
  me: () => request<Me>("/api/v1/users/me"),

  // venue
  venues: () => request<{ venues: Venue[] }>("/api/v1/host/venues"),

  /** from/to are inclusive venue-local dates. `all` includes cancelled
   *  and expired claims for the ledger; the calendar wants live only. */
  schedule: (venueId: string, from: string, to: string, all = false) =>
    request<Schedule>(
      `/api/v1/host/venues/${venueId}/schedule?from=${from}&to=${to}${all ? "&include=all" : ""}`,
    ),

  createBooking: (b: NewBooking) =>
    post<{ order_id: string; claim_id: string }>("/api/v1/host/bookings", b),

  /** "Session over": frees the station from now, keeps it counted as booked. */
  releaseClaim: (claimId: string) =>
    post<{ id: string; released_at: string; expected_end_at: string }>(
      `/api/v1/host/claims/${claimId}/release`,
    ),

  updateClaim: (claimId: string, patch: BookingPatch) =>
    request<Claim>(`/api/v1/host/claims/${claimId}`, { method: "PATCH", body: JSON.stringify(patch) }),

  cancelClaim: (claimId: string, reason?: string) =>
    post<Claim>(`/api/v1/host/claims/${claimId}/cancel`, { reason }),

  revenue: (venueId: string, from: string, to: string) =>
    request<Revenue>(`/api/v1/host/venues/${venueId}/revenue?from=${from}&to=${to}`),

  createBlock: (venueId: string, b: NewBlock) =>
    post<Block>(`/api/v1/host/venues/${venueId}/blocks`, b),
  deleteBlock: (blockId: string) =>
    request<void>(`/api/v1/host/blocks/${blockId}`, { method: "DELETE" }),

  // app bookings that need the owner's decision
  acceptOrder: (orderId: string) => post<{ status: OrderStatus }>(`/api/v1/orders/${orderId}/accept`),
  rejectOrder: (orderId: string) => post<{ status: OrderStatus }>(`/api/v1/orders/${orderId}/reject`),
};
