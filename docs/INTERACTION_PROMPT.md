# Prompt: make every control work, and make the app feel alive

You own this product. Where this doesn't specify something, decide it yourself
and say why. Report what you verified, not what you assume.

## 1. Audit before fixing

The claim is that "most buttons and components are not working". Do not take
that at face value and do not dismiss it either — go find out. Open the app and
systematically exercise every screen: tap every button, chip, toggle, row,
icon and card, in both worker and poster mode. Write down for each one what
happened: navigated, wrote to the database, showed a toast and did nothing, or
did nothing at all.

Classify what you find:
- **Broken** — has a handler that fails, or navigates somewhere dead.
- **Cosmetic** — looks tappable, isn't, and shouldn't be.
- **Hollow** — "works" but only shows a message; nothing is persisted.
- **Missing** — the design implies an action that has no control at all.

Fix all four categories. A control that silently does nothing is worse than one
that isn't there.

## 2. "Complete by" should be a pleasure to use

The date and time picker is functional and lifeless. Make it the most
interactive thing in the app:
- Animate the sheet in and out rather than snapping.
- Animate month changes, and the selection itself.
- Give immediate, obvious feedback on every tap — the chosen day, the chosen
  hour, AM/PM.
- Offer quick choices people actually want (this evening, tomorrow morning, this
  weekend) alongside the full calendar.
- Show the consequence of the choice in plain language: "in about 6 hours",
  not just a date.
- Never accept a past time, and say why when one is tapped.

Respect the design's visual language. Motion should feel quick and physical —
spring, not linear fade — and must not block the user from tapping through it.

## 3. Location has to actually work

Today the picker falls back to the device geocoder and says so. Finish it:
- Current location must work on web and on Android, with a clear message when
  permission is refused, when it times out, and when the device can't resolve a
  name.
- Search must return real places. Use Google Places when
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is set. Do not invent a key, do not commit
  one, and do not ask the user for it mid-flow — read it from the environment,
  document it in `.env.example` and the README, and degrade gracefully when it's
  absent.
- Whatever the source, store real coordinates alongside the label, so distance
  between two people can finally be computed rather than guessed.
- Remember the user's last location so they aren't re-picking it constantly.

## 4. Make the app more capable

Use your judgement about what this product is missing. Prioritise by what a
real poster or worker would hit within their first hour, not by what is easiest.
State your reasoning for what you chose and what you deliberately left out.

Anything you add must be real: backed by the database, enforced server-side
where money or permissions are involved, and reachable from the UI.

## 5. Standing rules

- Money stays in integer paise; money and state transitions stay in
  SECURITY DEFINER RPCs that re-check auth.uid().
- Never invent data to fill a screen. Empty means empty, and say what will
  appear there.
- The design in `docs/design/` is the visual spec.
- `npm run check` stays green. Add tests for anything with rules in it.
- Verify in the browser and confirm writes in Postgres directly.
- Commit in logical chunks.
