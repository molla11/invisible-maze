# Invisible Maze

Invisible Maze is a two-player hidden-maze race built with Next.js. The local runtime is server-authoritative through route handlers and an in-memory store so it can be played immediately in development. Supabase schema and environment boundaries are included for deployment hardening.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000` in two browsers or two profiles. Use automatic matching or create a room code and join from the second browser.

## Environment

Copy `.env.example` to `.env.local` and fill values when deploying:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

Turnstile verification is enforced in production when `TURNSTILE_SECRET_KEY` is set. Without Supabase credentials, the app uses the local in-memory store.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```
