# TaskDrop

Reverse-marketplace: a Poster publishes an open-ended request with a benchmark price, Workers pitch and negotiate quotes, and funds sit in escrow until the work is verified.

## One app, two platforms — identical features, always in sync

TaskDrop is **a single React Native codebase** that runs on **Android** (Expo) and on the **web** (via `react-native-web`). The web version is not a separate app — it is the same screens, the same components and the same Supabase database, rendered in a browser. That means:

- Every feature on Android exists on web automatically.
- The two can never drift apart, because there is only one implementation.
- Both read and write the same Postgres through Supabase, so data is live-synced.

```
apps/
  mobile/      The TaskDrop app — Android + web from one codebase
packages/
  rules/       Business constants (20% commission, 3% poster fee, 5% fine, 7d clearing…)
  schemas/     Zod validation shared by the app + Edge Functions
  supabase/    Typed Supabase client factory
  db-types/    TypeScript types generated from the Postgres schema
supabase/
  migrations/  SQL migrations (source of truth for the schema)
docs/
  design/      The source design (TaskDrop App.dc.html) + extracted markup/logic
```

## Running it

```bash
npm install

# Web version (the full app in a browser)
npm run web            # http://localhost:8081

# Android — prints an Expo Go QR code to scan with your phone
npm run android

# Deployable static web build
npm run web:export     # outputs apps/mobile/dist
```

Other commands:

```bash
npm test               # money-math + schema unit tests
npm run typecheck
npm run db:types       # regenerate DB types after a schema change
```

## Supabase project

- Ref: `wjxvingpfbfvkfqhrguj` · Region: `ap-south-1` (Mumbai)
- URL: https://wjxvingpfbfvkfqhrguj.supabase.co

## Design

The design is the source of truth for every screen. `docs/design/TaskDrop App.dc.html` is the original;
`docs/design/_design_markup.html` is its extracted visual markup and `docs/design/_design_source.jsx`
its data/logic layer. Screens are ported to match this markup exactly.

## Location and place search

Place search works out of the box with no configuration: it uses OpenStreetMap's
Nominatim, which needs no key and returns real coordinates on both web and
device. That matters because a place label with no latitude and longitude is
how "Distance: nearby" ends up being a guess.

To use Google Places instead — better results for Indian addresses — set:

```
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

Restrict the key to the Places API and to your own origins before shipping.
Anything prefixed `EXPO_PUBLIC_` is visible in the client bundle.

The lookup order is Google Places (if a key is set) → Nominatim → the device
geocoder (native only). Whatever the source, the chosen place is stored with its
coordinates, and the last few places you picked are kept on the device so you
aren't searching for home every time.
