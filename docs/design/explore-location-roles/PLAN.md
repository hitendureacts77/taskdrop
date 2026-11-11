# D26: Explore map, location first and one side per mode

Owner request, 11 Nov 2026. Designed by Opus 5.5, built by Sonnet 5.5 agents ([[feedback-model-split]]).

## What is wrong today

1. **No location ask.** Explore never asks for location. A guest whose saved area is stale (or who confirmed the
   picker's Bengaluru fallback pin) sees Bengaluru while standing in Hyderabad.
2. **Your own marker is hard to see.** It is a 14 px dot, drawn *under* the pins, in ink colour on the
   People layer, and the map's dim overlay makes it fainter still.
3. **Both sides see both sides.** Hire (poster) and Earn (helper) can each pick Jobs *and* Helpers on the map.
   A poster sees other posters' tasks, and the Hire list's "Task prices" card offers **"Post one like this"**
   on another poster's task. A helper sees other helpers, and the helper card offers **"Post a task"**.

## Rules after this change

| Mode | Map shows | Locked chip | Card action |
| --- | --- | --- | --- |
| Hire (poster) | Helpers (and "People" if signed in) | **Jobs 🔒** → "Switch to Earn mode" sheet | Helper card: View profile · Post a task |
| Earn (helper) | Jobs (and "People" if signed in) | **Helpers 🔒** → "Switch to Hire mode" sheet | Job card: **Send quote** (opens the task, where the offer box sends an offer or a counteroffer) |

- A helper on a poster's task can only **quote or counter-quote**. Nothing on the map asks a helper to post a
  task or "offer a service" to a poster's task, and nothing asks a poster to post a task for another poster.
- "People" (my people + opted-in nearby adults, plan D20) carries no role, so it stays on both sides; its
  stranger card says "post a task" in Hire and "send a quote on one of their tasks" in Earn.
- The server rules do not change: this is what each side is *shown*.

## 1. Location first

### When Explore's map opens
1. Check the permission **without asking** (`locationPermission()`).
2. **Granted** → read the position quietly (`resolveCurrentPlace`, the fast last-known fix first). The map
   centres on it and your marker says **You**. If you have no saved area yet, this place is saved as your
   area (guest: on the device; signed in: profile), so the lists stop saying "Set your area".
3. **Not granted** → once per app launch, the **Location sheet** opens (below). Not shown while you are
   looking around another place you picked.

Centre priority on the map: place picked to look around → live position → saved area → no area (India map
with the card).

### Location sheet (`components/LocationPrompt.tsx`, a `BottomSheet` so the keyboard works on phones)
**Step "ask"**
- Art: a pin inside two soft pulsing rings (static under reduced motion), in the mode's colour.
- Title: **Turn on location for the best Explore experience**
- Body: "See helpers and tasks right around you, and your own spot on the map. We only use it while
  TaskDrop is open. Others only ever see your area, never your exact spot."
- Primary: **Turn on location** → the system dialog. Success closes the sheet and the map flies to you.
  - Refused → the sheet moves to step "type" with "No problem. Type your area instead."
  - Location off for the whole phone → Android's own "turn on location" dialog first
    (`askToTurnOnLocation`), then reads again.
  - Blocked for good: native → button becomes **Open settings**; web → a line "Location is blocked for this
    site. Allow it from the icon beside the address, then tap Try again." with **Try again**.
- Secondary: **Type my area instead** → step "type".
- Text link: **Not now** (closes; the map keeps whatever centre it had).

**Step "type"**
- Back arrow + title **Type your area**.
- Search field, focused: placeholder "Area or locality, e.g. Madhapur, Hyderabad". Results after a 350 ms
  pause (`searchPlaces`: Google via the server, else OpenStreetMap, so guests get results too).
- Each result is a row (pin icon, name, rest of the address). Tap → saved as your area, sheet closes, map
  centres there, your marker says **Your area**.
- "Searching…", "No places match. Try a nearby landmark or the city name." states.

### The "no area" card on the map
"Choose your area to see what's around you" becomes:
- Title **Turn on location to see what's around you**
- Primary **Use my location** (same as Turn on location) · secondary **Type my area**.

## 2. Your marker

Same on Google (native), MapLibre (web) and the tile fallback:
- 18 px royal-blue dot, 3 px white rim, soft shadow; a 44 px halo of the same blue at 18 % behind it,
  gently pulsing on web/tiles (static on native and under reduced motion).
- A small pill under it: **You** (live position) or **Your area** (typed or saved area), ink background,
  white 11 px bold text.
- Drawn **above** every pin (native `zIndex` 1000; web/tiles rendered after the pin layer) and never dimmed.
- New optional prop on `JobsMap`: `meKind?: 'live' | 'area'` (default `'area'`).

## 3. One side per mode

- `NearMap` reads `useMode()`. Allowed layers: Hire → `people` (+ `mine` when signed in); Earn → `jobs`
  (+ `mine`). Any other layer asked for (also by the `nearMap` route) falls back to the side's own layer.
- The layer switch (Segmented on wide screens, QuickChips on phones) shows the other side as a **locked**
  option with a lock icon. Tapping it opens **`ModeLockSheet`**:
  - Hire tapping Jobs: title **Tasks are in Earn mode**; "In Hire mode the map shows helpers you can hire.
    To see tasks people posted near you and send them a quote, switch to Earn mode." Buttons **Switch to Earn
    mode** (blue) · **Stay in Hire mode**.
  - Earn tapping Helpers: title **Helpers are in Hire mode**; "In Earn mode the map shows tasks you can quote
    on. To see helpers near you and post a task for them, switch to Hire mode." Buttons **Switch to Hire
    mode** (jade) · **Stay in Earn mode**.
  - Switching flips the app mode; Explore then opens that side's layer by itself.
- Job card (Earn): "Open task" → **Send quote**.
- Helper card: "Post a task" only in Hire.
- Hire list (`NearYou`): the "Task prices" tab, its jobs map and **Post one like this** go; a locked
  **Tasks 🔒** pill opens the same `ModeLockSheet`.

## Build split
- A (Sonnet): `JobsMap.native.tsx`, `JobsMap.web.tsx`, `JobsMap.tiles.tsx` — the marker + `meKind`.
- B (Sonnet): new `lib/useLivePlace.ts`, `lib/locationAsk.ts` (+ test), `components/LocationPrompt.tsx`.
- C (Sonnet): `NearMap.tsx`, `NearMapParts.tsx`, `HelperSheet.tsx`, `NearYou.tsx`, new
  `components/ModeLockSheet.tsx`, then `ExploreScreen.tsx` wiring.
- Opus: review, `npm run check`, web check on localhost, merge, OTA.

## Not in this change
- Server-side role filtering (the server already decides who may offer on what).
- Showing other helpers to a helper for "competition" pricing: the owner wants the switch instead.
