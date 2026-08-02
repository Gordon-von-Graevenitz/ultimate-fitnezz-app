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
- Installable PWA with offline application-shell caching
- Device-local persistence through a signal-based data store

No account or cloud service is required. Records remain in the current browser's local storage. Clearing browser data removes the records, so this version should be treated as a local MVP rather than a production backup system.

## Run locally

```bash
pnpm install
pnpm start
```

Open the local address printed by Angular.

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
