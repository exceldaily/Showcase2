# Accounts (invite-only)

AlphaForge is private. Nobody can create an account unless the owner invites them.

## How it works

- **Sign in** at `/login` with a username and password. No email confirmation, no password rules beyond 4+ characters.
- **Owner** is the one account that can invite people. It is created once at `/claim` using the site passcode (`SITE_PASSCODE`). After the first account exists, `/claim` is permanently disabled and answers 409.
- **Invites** live at `/invites` (owner only, also in the nav). Each invite is a single-use link that expires in 7 days. You can email it (Brevo) or just copy the link and text it. Only a SHA-256 of the token is stored, so the raw link is shown once.
- **Members** can be disabled (blocks sign-in and ends every live session immediately) or removed from the same page.
- **Owner-only actions:** invites, member management, and placing or cancelling paper orders (the Alpaca paper account belongs to the owner; members get a view-only terminal).

## Devices, locations, and shared logins

- Every sign-in creates a **device session** (`login_sessions`) and the cookie carries its id. The Members table shows signed-in devices vs the cap, and the details panel lists each device (browser + OS, city, IP, last seen) with a sign-out button, plus the recent sign-in history (success and failed attempts).
- **Device cap** defaults to 2 per member (owner can set 1 to 5 per person). Past the cap, the least recently seen device is signed out and sees a "device limit" notice on the login page. Dropping the cap trims devices immediately.
- **Sharing detection:** if the same account is used from two different cities (or two IPs when the city is unknown) within 30 minutes, the account gets a FLAGGED badge with the reason and the owner gets an email (`ALERT_EMAIL_TO`). First sign-in from a new country also emails the owner. Clear the flag from the Members table.
- Location comes from Vercel's geo headers (city/region/country), so it is city-level and VPNs show the VPN's city. Locally these headers are absent and the place reads "unknown location".
- Disabling a member revokes all of their devices at once.

## Under the hood

- `src/lib/auth/session.ts` signs a small JSON payload with HMAC-SHA256 (WebCrypto, so it runs in the Edge middleware). Cookie `af_session`, 30 days.
- `src/lib/auth/password.ts` hashes with scrypt (`scrypt$salt$hash`).
- `src/lib/auth/users.ts` holds the DB logic: sessions, login throttle (8 failures per 10 minutes per IP+username, best effort per instance), invites, members.
- `src/middleware.ts` verifies the cookie signature for every page and API route. Public: `/login`, `/join/*`, `/claim`, `/api/auth/*`, and the cron endpoints that carry their own `CRON_SECRET`.
- `src/app/layout.tsx` re-checks the user row on each page render. A disabled, deleted, or version-bumped account is redirected through `/api/auth/logout` which clears the cookie.
- Tables: `users` (extended from 0001) and `invites`, migration `db/migrations/0014_accounts.sql`.

## Environment

- `AUTH_SECRET` signs cookies. Rotating it signs everyone out.
- `SITE_PASSCODE` is only used by the one-time owner claim.
- With neither set the site is open (local dev without a database).
