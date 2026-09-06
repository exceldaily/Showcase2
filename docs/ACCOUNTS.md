# Accounts (invite-only)

AlphaForge is private. Nobody can create an account unless the owner invites them.

## How it works

- **Sign in** at `/login` with a username and password. No email confirmation, no password rules beyond 4+ characters.
- **Owner** is the one account that can invite people. It is created once at `/claim` using the site passcode (`SITE_PASSCODE`). After the first account exists, `/claim` is permanently disabled and answers 409.
- **Invites** live at `/invites` (owner only, also in the nav). Each invite is a single-use link that expires in 7 days. You can email it (Brevo) or just copy the link and text it. Only a SHA-256 of the token is stored, so the raw link is shown once.
- **Members** can be disabled (blocks sign-in and ends every live session immediately) or removed from the same page.
- **Owner-only actions:** invites, member management, and placing or cancelling paper orders (the Alpaca paper account belongs to the owner; members get a view-only terminal).

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
