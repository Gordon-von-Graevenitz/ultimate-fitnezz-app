# BarBelle's Fitness Studio

A trainer-only Angular application for managing personal-training customers, reusable workout plans, recorded sessions, goals, measurements, and performance insights.

## What is included

- Customer directory with search, status filters, coaching notes, and onboarding
- Customer profiles with goals, workout history, and measurements
- Reusable workout templates built from an exercise library
- Touch-friendly workout recorder with elapsed/rest timers
- Set tracking for weight, reps, duration, distance, RPE, notes, and completion
- Progress insights generated from recorded data
- Responsive desktop, tablet, and mobile layouts
- Installable PWA with an authenticated, network-first application shell
- Cloudflare Access session checks before customer data is rendered
- Tenant-isolated Cloudflare D1 persistence with a device cache for resilience

Hosted records are stored in Cloudflare D1. The Worker verifies the Cloudflare Access JWT and derives the database owner from that verified identity; clients cannot choose or override an owner ID. Each trainer can read and replace only their own records. The browser keeps an account-scoped cache, but D1 is the hosted source of truth.

## Run locally

For the Angular frontend only:

```bash
npm start
```

Open `http://localhost:4200`. This frontend-only mode uses browser local storage and does not exercise the Worker or D1.

For the complete local Worker and D1 stack:

```bash
npm run preview:cloudflare
```

Open the local address printed by Wrangler, normally `http://localhost:8787`. Wrangler uses the git-ignored `.dev.vars` identity and the local D1 database under `.wrangler`; it does not read or write the production D1 database.

The local identity bypass is accepted only for exact loopback hostnames. Deployed hostnames always require a valid Cloudflare Access JWT.

`preview:cloudflare` is deliberately local-only. Cloudflare has no local Workers AI emulator, so database and application features work without touching production, while AI requests are unavailable. To connect the local Worker to Workers AI, install `cloudflared` and run `npm run preview:cloudflare:ai`; remote AI usage may be billable.

## Verify

```bash
npm run build
npm test -- --watch=false
npm run test:worker
npm run typecheck:worker
```

## Architecture

The app uses Angular standalone components, lazy feature routes, signals and computed state, reactive forms, strict domain models, and a feature-first directory layout:

```text
src/app/
├── core/
│   ├── data/
│   └── models/
└── features/
    ├── clients/
    ├── dashboard/
    ├── progress/
    ├── workout-session/
    └── workouts/
```

`LocalDataStore` is the application-facing state facade. It performs immediate in-memory updates, keeps an account-scoped device cache, and queues ordered writes through `FitnessDataApi`. The Worker validates the Access token and writes normalized, owner-scoped records to D1.

## Database and deployment

Apply pending migrations before deploying a Worker that depends on them:

```bash
npx wrangler d1 migrations apply barbelles-fitness-prod --remote
npm run deploy:cloudflare
```

The first migration creates the user, client, goal, measurement, exercise, workout plan, workout session, set, and audit tables. Progress photographs are deliberately excluded.

## Existing phone installations

After deploying this authentication update, open this address once on each already-installed PWA:

```text
https://ultimate-fitnezz-app.hushed-candy.workers.dev/?ngsw-bypass=secure-auth-v1
```

The bypass forces the old cached PWA to contact Cloudflare, show Access sign-in when needed, and download the authenticated version. The query parameter is removed after a successful session check. Existing `localStorage` customer and workout data is not cleared.

The installed PWA and its legacy `localStorage` are tied to this exact hostname. This project deploys to the existing `ultimate-fitnezz-app` Worker so installed phones receive the update.

If D1 has no data for the signed-in account and the device contains records from the previous local-only version, the app asks before importing them. The legacy copy is removed only after D1 confirms the write; an account-scoped device copy remains. A cloud account with existing data always wins over legacy device data.

Production startup now requires a live Access session, so the trainer must be online when opening the app. Angular also checks for a newer PWA version and reloads when one is ready.
