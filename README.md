# BarBelle's Fitness Studio

A trainer-only Angular application for managing personal-training customers, reusable workout plans, recorded sessions, goals, measurements, progress photos, and performance insights.

## What is included

- Customer directory with search, status filters, coaching notes, and onboarding
- Customer profiles with goals, workout history, measurements, and progress photos
- Reusable workout templates built from an exercise library
- Touch-friendly workout recorder with elapsed/rest timers
- Set tracking for weight, reps, duration, distance, RPE, notes, and completion
- Progress insights generated from the locally recorded data
- Responsive desktop, tablet, and mobile layouts
- Installable PWA with an authenticated, network-first application shell
- Cloudflare Access session checks before customer data is rendered
- Device-local persistence through a signal-based data store

Records remain in the current browser's local storage. Cloudflare Access protects the hosted app, but it does not sync or back up workout data. Clearing browser data removes the records, so this version should still be treated as a local MVP rather than a production backup system.

## Run locally

```bash
pnpm install
pnpm start
```

Open the local address printed by Angular.

Authentication is skipped by Angular's development build. The production build expects the Worker hostname to be protected by Cloudflare Access.

## Verify

```bash
pnpm run build
pnpm exec ng test --watch=false
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

`LocalDataStore` is the persistence boundary. A future cloud repository can replace or wrap it without moving persistence concerns into page components.

## Existing phone installations

After deploying this authentication update, open this address once on each already-installed PWA:

```text
https://ultimate-fitnezz-app.hushed-candy.workers.dev/?ngsw-bypass=secure-auth-v1
```

The bypass forces the old cached PWA to contact Cloudflare, show Access sign-in when needed, and download the authenticated version. The query parameter is removed after a successful session check. Existing `localStorage` customer and workout data is not cleared.

The installed PWA and its `localStorage` are tied to this exact hostname. Because `wrangler.jsonc` currently names the new Worker `barbelles-fitness`, deploying only to that new Worker will not update the existing phone installation or move its local data. Keep deploying this build to the existing `ultimate-fitnezz-app` Worker until data export or cloud sync is available.

Production startup now requires a live Access session, so the trainer must be online when opening the app. Angular also checks for a newer PWA version and reloads when one is ready.
