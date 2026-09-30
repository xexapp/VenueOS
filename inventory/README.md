# XEX VenueOS — dashboard

Vite + React + TypeScript SPA. Rosewood palette, Instrument Serif display,
DM Sans body. Deploys as a static bundle to Cloudflare Pages.

## Run

    npm install
    npm run dev        # localhost:5173, proxies /api to localhost:8080
    npm run typecheck
    npm run build      # -> dist/

## Cloudflare Pages

Build command: `npm run build`
Output directory: `dist`
`public/_redirects` gives the SPA fallback, `public/_headers` sets caching
and security headers. No serverless functions; the Go API does everything.

Set `VITE_API_BASE` in the Pages environment to the deployed API origin.
The API must send `Access-Control-Allow-Origin` for the dashboard origin
explicitly (not `*`) because requests carry an Authorization header.

## Backend it talks to (XeX-api, package `internal/host`)

All host routes are JWT-authenticated and scoped by ownership: the caller
must be `listings.owner_user_id` of the venue. Sign-in is the app's own
phone + OTP (`/auth/otp/send`, `/auth/login/verify`).

| Call | Used by |
|---|---|
| `GET  /api/v1/host/venues` | shell: venue, stations, bookables, hours |
| `GET  /api/v1/host/venues/:id/schedule?from=&to=[&include=all]` | dashboard, calendar (one week per fetch), ledger |
| `POST /api/v1/host/bookings` | new phone / walk-in / other-platform booking |
| `POST /api/v1/host/claims/:id/release` | "End session now" |
| `PATCH /api/v1/host/claims/:id` | move, extend, shorten, correct details |
| `POST /api/v1/host/claims/:id/cancel` | cancel (not paid app bookings, until refunds exist) |
| `GET  /api/v1/host/venues/:id/revenue?from=&to=` | Revenue tab |
| `POST /api/v1/host/venues/:id/blocks`, `DELETE /api/v1/host/blocks/:id` | block time |
| `POST /api/v1/orders/:id/accept`, `/reject` | decide an app request |

The API must list this dashboard's origin in `CORS_ALLOWED_ORIGINS`.

## Conventions

- No Tailwind. CSS Modules plus one token file, because the design specifies
  values (14.5px, 0.09em, #EBE3E4) rather than scale steps.
- No client state library. TanStack Query owns server state; local UI state
  is useState. There is nothing else to hold.
- Backend enums are translated in exactly one place, `src/lib/status.ts`,
  using exhaustive switches so a new server state fails the build.
- All times formatted in Asia/Kolkata. No timezone switcher, ever.
- The sign-in token lives in localStorage (`venueos.token`); a 401 signs out.
