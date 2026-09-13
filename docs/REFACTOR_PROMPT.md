# Prompt: refactor, test, and finish TaskDrop

Work through this without asking for confirmation. Use your own judgement on
anything not spelled out. Report what you verified, not what you assume.

## Context

TaskDrop is one Expo/React Native codebase (`apps/mobile`) that ships to Android
and to web via react-native-web, backed by Supabase. Money is always integer
paise. Every state or money transition is a SECURITY DEFINER Postgres RPC that
re-checks `auth.uid()`; nothing about money is trusted from the client.

The full loop is proven working end-to-end through the UI:
post -> quote -> lock -> start -> mark done -> release -> review, with the
worker's clearing balance landing at exactly 80% of the locked price. Do not
regress that. Re-prove it when you are done.

## 1. Refactor

The screens were ported one at a time from the design, and it shows. Fix the
structural duplication without changing a single pixel of the rendered result:

- `tx()`, `FadeIn`, `Pressy` and the shimmer/skeleton helpers are copy-pasted
  across a dozen screen files. Extract one copy each into shared components and
  delete the duplicates. Keep the exact animation timings and press scales that
  are there now, because they are the design's.
- Status/label/tone mapping for tasks is spread between OrdersScreen mappers and
  ad-hoc ternaries elsewhere. Put the DB-status -> display mapping in one place
  and have every screen read from it.
- `data/api.ts` casts RPC names through `as never`. The generated types now
  include every RPC, so type the calls properly and drop the cast.
- Money formatting and parsing must exist once. Delete any local rupee parsers.

Do not "improve" the visual design. The design in `docs/design/` is the spec.

## 2. Fix the fake data still wired into live screens

These screens render hardcoded sample values on top of real records, which makes
the app lie to the user. Each must show the real row:

- ProfileScreen: shows a hardcoded name, star rating, job count and two invented
  reviews. Read the signed-in profile and their real reviews.
- ActiveScreen: hardcoded escrow amount and a fabricated counterparty name and
  phone number. Show the real assignment and the real revealed contact.
- ConfirmScreen: the "held in escrow" line and the "proof submitted" blurb are
  fallbacks. Pass and show the real escrow; do not invent proof text.
- CompareScreen: the "12 QUOTES" count and the "complete by" date are hardcoded.
- SwipeScreen: falls back to a sample price/deadline instead of the real one.
- OrdersScreen: poster rows say "Waiting for quotes" even when quotes exist, and
  do not pass price/deadline/escrow onward to the screens they open.
- HomeScreen: live rows show a generic "Poster" with no rating. Join the real
  poster identity.

MyQuotes, Chat, Promote and Pro are still entirely sample data. Either back them
with real tables or make it unmistakable in the UI that they are previews. Do not
leave them looking live when they are not. Chat matters most, since the product
promises contacts are revealed on start.

## 3. Fix the flow bugs found while testing

- A returning user is sent through profile setup on every sign-in. They should
  land on home; setup is for first run or an explicit edit.
- The splash screen waits forever for a tap with no affordance. Auto-advance,
  keeping tap-to-skip.

## 4. Tests

There are none. Add them where they protect the money and the rules:

- Postgres: prove the commission split, that a non-participant cannot release,
  that a second `start_task` on a started task loses, that `request_withdrawal`
  refuses to overdraw, and that `submit_review` refuses a stranger.
- TypeScript: unit-test the money helpers and the status mapping.
- Wire `typecheck` + `lint` + `test` into one command that must pass.

## 5. Verify

Typecheck and lint clean. Start the dev server, drive the whole loop in the
browser with two accounts again, and confirm each transition by querying
Postgres directly. Check the console for errors at every step. Fix what you
find, then re-run.

Commit in logical chunks with real messages.

## Known blocker, do not paper over

Razorpay has no API keys set, so escrow cannot actually be funded. The Edge
Function already returns a clear message and the app now surfaces it. Leave it
that way; do not stub a fake payment success.
