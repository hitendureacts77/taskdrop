# Map-first Explore + "My people" map: build plan (D20, proposed)

Status: plan only, nothing built. Written 8 Nov 2026 against `redesigned-2.0`.
Owner request: Explore opens the full map (like Instagram's map page), and a Snap Map-style map of people, on Android and web alike. Every existing feature stays.

---

## (a) Goals and non-goals

**Goals**
1. Tapping **Explore** (Earn: **Find work**) lands on the full-screen map at once. This is the D14 map (`NearMapScreen`) built into the tab. A **List** pill switches to today's Explore page, unchanged.
2. The map gets a third layer, **My people**: the people you have finished a task with, shown as face pins. Each person appears only if they chose to share, and only at a rounded spot (about 550 m) for as long as they are active. This is TaskDrop's version of Snap Map's friends.
3. The same feature on Android (native tabs) and web (phone bottom bar + desktop SideNav). One component set.
4. Privacy by default. Sharing is opt-in. The server rounds every spot, and spots go stale after 15 min. One tap hides you (ghost). Guests never see or join the people layer. Exact lat/lng of another user never leaves the database.

**Non-goals**
- No sixth tab (see decision 1). No follow, friend-request or chat-from-map social graph.
- No live tracking of a worker during a job. "Live Track" was rejected on 1 Nov, so in-progress tasks do not count as "my people".
- No background location, no location history, no realtime channel.
- Nothing removed: `nearMap` stays as a route (Home's NearYou / JobsNearHero still open it), and the Explore list content, filters, List/Map pills in Find work, templates, Ideas, Busy now and How it works all stay.
- No tile-provider change in this build (see risks).

---

## (b) Decisions (with defaults, so building can proceed)

| # | Decision | Default taken | Why |
|---|---|---|---|
| 1 | New "Map" tab, or merge into Explore? | **Merge: the Explore tab is the Map tab.** The label stays "Explore"/"Find work". The icon becomes a map (native `md: "map"`, `sf: "map"/"map.fill"`; web adds a `map` icon to `Icon.tsx`). | Android's native bottom bar (`expo-router/native-tabs` → Material BottomNavigationView) holds at most **5** items, and all 5 are taken (`nativeTabs.ts`). A sixth tab would mean dropping Wallet or Profile (that removes a feature) or a custom bar (AGENTS.md: do not extend expo-router without approval). The web `BottomTabBar` is also 5-wide at 390 px. On desktop `SideNav` the "Explore" item keeps its place. The tour only says "Explore for ideas" (`lib/tour.ts` L201) and sends Earn finishers to `go('explore')` (TourHost L152). That still works and now shows them the job map. |
| 2 | Default view on entering Explore | **Map**, every time the tab is entered from elsewhere. The last List/Map choice lasts only for the session while you stay on the tab. **Exception:** arriving with list intent (`params.q`, `params.focusSearch`, `params.filter`, `params.category`, e.g. Home's search bar) opens **List**. | Keeps Home search → Find work results working exactly as today. |
| 3 | Map layers and default layer | Chips **Jobs · Helpers · My people**. Default: Earn → Jobs, Hire → Helpers (today's `nearMap` modes `jobs`/`people`). My people is hidden for guests. | Re-uses D12/D13/D14 exactly. |
| 4 | Who counts as "my people" | Both sides of a task with status `COMPLETED` or `AUTO_COMPLETED`: the poster and the hired worker (`assignments.worker_id`). Not blocked in either direction (`public.blocks`), not deleted (`profiles.deleted_at is null`), onboarded. | Already mutual, already met, already saw each other's address. Same source as Regulars (`myRegulars`, reads.ts L527), widened to both directions. |
| 5 | What strangers see | **Unchanged.** Helpers at their chosen area (profiles `loc_lat/lng`, already rounded to 2 decimals ≈ 1.1 km by migration 074) with the existing "Active now" dot; jobs at their rounded area. **Strangers never see a live spot.** | The present behaviour is already live and public. A live spot for strangers is the stalking risk. |
| 6 | Presence vs. new consent | **Presence stays automatic** (PresenceBeat writes `last_seen_at` every minute; "Active now" < 3 min, `lib/presence.ts`). No go-live switch is added. The only new consent is **"Show my spot to my people"** (off by default). It shares a rounded device position, only with decision-4 people, only while the app is open and in front. Turning it off is the ghost mode and deletes the spot at once. | Fits "no go-live toggle": presence needs no switch. Sharing a *position* is new personal data under the DPDP Act and needs its own clear opt-in that can be withdrawn. `profiles.live_until` (migration 048) is an old go-live column. **Do not reuse it.** |
| 7 | Spot accuracy and lifetime | Snap to a **0.005° grid** (≈ 550 m N-S, ≈ 520 m E-W at Indian latitudes), cell centre. The client snaps before sending and the server snaps again. Expires **15 min** after the last beat. A beat at most every 2 min, and only when the cell changed or 10 min have passed. | Coarser than a street, finer than the public 1.1 km area, and shown only to people you have worked with. |
| 8 | Polling vs. realtime | **Polling**: the My people layer refetches every **60 s** while the Explore map is focused and the app is in front. The jobs and helpers layers keep today's fetch (on centre, radius or focus change). The spot rides on the existing `touchPresence` call (a new optional arg), so no extra request per minute. | Realtime on a security-definer view is hard to lock down and costs connections. Fits the API-call budget work (PRs 65-67, 174). |
| 9 | Admin kill switch | **Not in this build.** Sharing is per-person opt-in on staging. Ask the owner before launch whether to add `people_map` to `app_controls` (that means re-creating `get_app_controls`/`admin_set_app_control` + an admin repo change). | Keeps the migration small and safe to auto-apply. |
| 10 | Tile source on web | Keep the current tiles (`tile.openstreetmap.org`, `MapPicker.tiles.tsx` L62) for staging. | See risk R1: production needs a decision. |

**Owner-only decisions to put in ULTIMATE_PLAN after the build (as decision 35 and design D20; the next free numbers on 8 Nov):**
- **35a**: ANSWERED 8 Nov by the owner: the tab stays **"Explore"** (with the map icon). No rename.
- **35b**: ANSWERED 8 Nov by the owner: **yes, strangers can see live spots.** Built as migration 160: it is a second opt-in. A sharer picks "My people" (default, and every existing sharer stays on it) or "Everyone nearby" (needs notice v2; switching sharing off puts it back to My people). A stranger sees less than someone you worked with: first name only, no photo, no job count, a ~2 km cell (0.02 degrees, not the 550 m one), within 25 km, nearest 30; the viewer must be a signed-in adult, blocks hold both ways, closed accounts never show, guests see nothing. The layer chip is now "People".
- **35c**: production map tiles: a paid tile provider (e.g. MapTiler/Stadia/Carto) vs. OSM. This must be settled before launch (R1).
- 35d: an admin kill switch for the people layer before launch (decision 9).

---

## (c) Work packages

One writer per file. Waves run in order, and packages within a wave run in parallel.

| Wave | WP | Owns (only writer) | Depends on |
|---|---|---|---|
| 1 | WP1 DB | `supabase/migrations/20261108120000_159_people_map.sql`, `supabase/tests/people_map.test.sql` | none |
| 1 | WP3 client data + spot | `apps/mobile/src/data/extras.ts`, `apps/mobile/src/lib/mapSpot.ts` (+ `mapSpot.test.ts`), `apps/mobile/src/lib/useMapSpot.ts`, `apps/mobile/src/components/PresenceBeat.tsx` | contract in this plan |
| 1 | WP4a map refactor | `apps/mobile/src/components/NearMap.tsx` (new), `apps/mobile/src/screens/NearMapScreen.tsx` | none |
| 2 | WP2 API | `supabase/functions/api/reads.ts`, `writes.ts`, `api.test.ts`, `contract.test.ts` | WP1 merged (names) |
| 2 | WP5 Explore map-first | `apps/mobile/src/screens/ExploreScreen.tsx`, `navigation/ScreenHost.tsx`, `app/(tabs)/_layout.tsx`, `components/BottomTabBar.tsx`, `components/SideNav.tsx`, `components/Icon.tsx`, `lib/tour.ts` (+ `tour.test.ts` if copy is asserted) | WP4a |
| 2 | WP6 consent + setting | `apps/mobile/src/components/PeopleMapSheet.tsx` (new), `components/PeopleMapCard.tsx` (new), `screens/AccountScreen.tsx` | WP3 |
| 3 | WP4b My people layer | `components/NearMap.tsx`, `components/NearMapParts.tsx`, `components/mapPins.ts` | WP3, WP4a, WP6 (sheet import) |
| 3 | WP7 e2e | `e2e/ui.spec.ts`, `e2e/map.spec.ts` (new) | WP5, WP4b |

Merging WP1 into `redesigned-2.0` **auto-applies migration 159 to staging**. Merge WP1 alone, check it applied, then merge WP2. Deploy the `api` function after WP2 merges (the usual flow). Run `security-review` on every PR (AGENTS rule 9). Re-check that 159 is still the highest number just before merging, and renumber if another branch took it.

---

### WP1: Database (migration 159)

**Behaviour:** two tables, four RPCs and one trigger, all additive. Details are in (d). **Accept:** `npm run test:db` passes with the new `people_map.test.sql` (the cases in (f)). `select` from `map_spots` as `authenticated` returns a permission error. Applying the migration twice is a no-op (`if not exists`, `create or replace`).

### WP2: API ops (`supabase/functions/api`)

Add these to `reads.ts`:
```ts
/** My people with a live rounded spot, nearest first (migration 159). Cells only, never exact. */
mapPeople: rpcOp("map_my_people", (a) => ({ p_lat: num(a,"lat",-90,90), p_lng: num(a,"lng",-180,180), p_radius_km: num(a,"radiusKm",0,50) })),
/** The caller's own sharing choice: { share_live, consented_at, notice_version } or null. */
mapSharing: async (ctx) => take(await ctx.db.from("map_sharing").select("share_live, consented_at, notice_version").eq("user_id", ctx.userId).maybeSingle()),
```
Add these to `writes.ts`:
- `setMapSharing({ on: boolean, notice: string })` → `rpc("map_sharing_set", { p_on, p_notice })`. Validate that `notice` is ≤ 20 chars and matches `/^v\d+$/`.
- `clearMapSpot()` → `rpc("map_spot_clear")`.
- `touchPresence`: accept an **optional** `spot: { lat, lng }`. After the `last_seen_at` update, if a spot is present, call `rpc("map_spot_beat", { p_lat, p_lng })` and swallow errors (presence is a nicety). With no arg the behaviour is identical to today (AGENTS rule 2).

Do **not** add any of these to `guest.ts` `GUEST_OPS`, so guests get `NEEDS_ACCOUNT`. Rate limits: the existing read/write buckets apply. `mapPeople` is a read, so it can be batched with `tasksNear`/`workersNear`.
**Accept:** `api.test.ts` has these cases: a guest calling `mapPeople` gets NEEDS_ACCOUNT; `touchPresence` without `spot` makes no RPC call; with `spot` it calls `map_spot_beat` once; a bad `notice` is rejected. `contract.test.ts` lists the new ops. `npm run check` is green.

### WP3: Client data, spot snapping, beat

- `data/extras.ts`:
  ```ts
  export type MapPerson = { id: string; display_name: string | null; avatar_url: string | null; last_seen_at: string | null;
    lat: number; lng: number; km: number; jobs: number; spot_at: string };
  export const mapPeople = (near: {lat:number;lng:number}, radiusKm: number) => quietly<MapPerson[]>('mapPeople', { lat: near.lat, lng: near.lng, radiusKm }, []);
  export const getMapSharing = () => quietly<{ share_live: boolean; consented_at: string|null; notice_version: string } | null>('mapSharing', {}, null);
  export const setMapSharing = (on: boolean) => act<null>('setMapSharing', { on, notice: PEOPLE_MAP_NOTICE });
  export const clearMapSpot = () => act<null>('clearMapSpot', {});
  ```
  Change `touchPresence(_userId, spot?: {lat:number;lng:number} | null)` to pass `spot` through only when given. Keep the 45 s client throttle.
- `lib/mapSpot.ts` (pure, no RN imports): `SPOT_GRID = 0.005`, `SPOT_TTL_MS = 15*60_000`, `BEAT_EVERY_MS = 120_000`, `PEOPLE_POLL_MS = 60_000`, `PEOPLE_MAP_NOTICE = 'v1'`, `snapCell(lat,lng)` → `{ lat: round(lat/G)*G, lng: round(lng/G)*G }` (fixed to 3 decimals), `shouldBeat(prev, next, now)` (cell changed, or ≥ 10 min since the last beat), and `isSpotFresh(spotAt, now)`. Write `mapSpot.test.ts` covering snapping at the cell edges, negative numbers, and the throttling rules.
- `lib/useMapSpot.ts`: a module-level store of `{ sharing: boolean, cell: {lat,lng}|null, at }` plus a hook. When sharing is on and the app is in front (`lib/inFront.ts`), every `BEAT_EVERY_MS` it calls `expo-location` `getCurrentPositionAsync({ accuracy: Balanced })`. It **only asks for foreground permission when the person turns sharing on** (never at start-up) and never requests background permission. It snaps on the device; exact coordinates never leave the hook. `nextSpot()` returns the cell to send, or null.
- `components/PresenceBeat.tsx`: pass `nextSpot()` to `touchPresence`.
**Accept:** unit tests pass. With sharing off, the network payload of `touchPresence` has no `spot`. With it on, `spot` values are multiples of 0.005.

### WP4a: Make the full map embeddable (no behaviour change)

- Move the body of `NearMapScreen` into `components/NearMap.tsx`:
  ```ts
  export type NearMapLayer = 'jobs' | 'people' | 'mine';
  export function NearMap(props: {
    layer: NearMapLayer; onLayer?: (l: NearMapLayer) => void;   // undefined = no layer chips (route use)
    centre: { lat: number; lng: number } | null;
    radiusKm?: number;
    /** Route: a close (X) button. Tab: a "List" pill in its place. */
    leading: { kind: 'close'; onPress: () => void } | { kind: 'list'; onPress: () => void };
    /** Bottom space taken by a tab bar the map must stay clear of (web phone bar is in-flow, so 0; native tabs: 0, SafeAreaView handles it). */
    bottomInset?: number;
    /** Shown in the sheet's low state under the stats: e.g. the remote-jobs line. */
    footer?: React.ReactNode;
  })
  ```
- `NearMapScreen` becomes a wrapper: it reads `params` (`mode`, `centre`, `radiusKm`) and renders `<NearMap layer={mode} centre={...} leading={{kind:'close', onPress: back}} />`.
- When `centre` is null, show a centred empty card over a plain `surface2` background: "Choose your area to see what's around you" plus a button that opens `LocationSheet`. The parent passes `onChooseArea`, which calls `useMyArea().choose`.
**Accept:** Home → NearYou "open map" and JobsNearHero expand look and behave exactly as before on web (phone + desktop) and Android: sheet low/up, picked card, swipe, "Search this area", reach menu, helper sheet. `npm run check` is green.

### WP5: Explore opens the map (depends on WP4a)

- `ExploreScreen.tsx`: keep `ExploreIdeas`/`FindWork` as they are and rename them internally to the list views. New top-level component:
  ```ts
  export function ExploreScreen() {
    const { mode } = useMode(); const { params } = useNav();
    const listIntent = ['q','focusSearch','filter','category'].some((k) => params[k] !== undefined);
    const [view, setView] = useState<'map'|'list'>(listIntent ? 'list' : 'map');
    // a new list intent while mounted (KEEP_ALIVE) flips to list: useEffect on those params.
    // re-entering the tab from another tab resets to 'map': useFocusTick() change with no list intent -> setView('map').
    ...
  }
  ```
  - Map view: `<NearMap layer={layer} onLayer={setLayer} centre={area} leading={{kind:'list', onPress: () => setView('list')}} footer={remoteLine} onChooseArea={choose} />`. Here `area` comes from `useMyArea()` and the layer defaults to `mode==='worker' ? 'jobs' : 'people'`, reset when the mode flips.
  - `remoteLine` (Jobs layer only): "N remote jobs aren't on the map · See them". Tapping it calls `setView('list')` and sets the FindWork filter to `remote` (lift `filter` initial state so the list can accept `initialFilter`). The count comes from `remoteTasks` (an existing op), fetched once per focus. This keeps remote tasks visible from the map (product rule: local AND remote).
  - List view: today's screen, plus a **Map** pill at the right of the AppHeader row (poster) or next to the search box (worker), which calls `setView('map')`. Width: because `explore` moves into `FULL` (below), wrap the list view in `View{ width:'100%', maxWidth: desktop ? (width>=XL_MIN_WIDTH?XL_CONTENT:WIDE_CONTENT) : tablet ? TABLET_CONTENT : undefined, alignSelf:'center', flex:1 }`. That is the same widths ScreenHost gives it today.
  - The map view does not render `AppHeader`. The map's top bar holds the title, the layer chips and the List pill. On desktop the SideNav is still there.
- `navigation/ScreenHost.tsx`: add `'explore'` to `FULL`. Leave it in `WIDE` and `KEEP_ALIVE` (the list view now constrains itself).
- `app/(tabs)/_layout.tsx`: the Explore trigger icon becomes `sf={{ default: 'map', selected: 'map.fill' }} md="map"`. The label is unchanged.
- `components/Icon.tsx`: add a `map` glyph (folded map, 24-grid stroke path like the others). `BottomTabBar.tsx` and `SideNav.tsx` use `icon: 'map'` for explore.
- `lib/tour.ts` L201 copy becomes: "Home for what's new, Explore for the map of what's around you, My Tasks to track your jobs, Wallet for your money, Profile for you." Update the Earn wording too if it mentions Find work as a list. Update `tour.test.ts` if it asserts the text.
- Motion: switching map ↔ list uses `FadeIn` 180 ms, or 120 ms with no translate under reduced motion (`useReducedMotion`).
**Accept:**
- Web phone (390×844), web desktop (1440), Android: tapping Explore shows the full map with the tab bar/SideNav still visible and the map not covered by it.
- List → today's page, pixel-equal apart from the Map pill. Home search → Find work opens in List with results.
- Mode switch on Explore flips the layer Jobs ↔ Helpers. Every existing filter and tab in the list view still works.

### WP6: Consent sheet and setting (depends on WP3)

- `components/PeopleMapSheet.tsx` (on `AppSheet`): the plain-language notice v1, shown before the first switch-on.
  - Title: "Show your spot to your people?"
  - Bullets:
    - "Only people you've finished a task with can see it."
    - "It's rounded to about half a kilometre, never your exact spot."
    - "Only while TaskDrop is open. It disappears 15 minutes after you close it."
    - "Turn it off any time; your spot is deleted at once."
    - "Strangers never see it. Guests never see it."
  - Buttons: "Share my spot" (asks for location permission via `useMapSpot`; if denied, flash "Location is off, so your spot can't be shared" and stay off) / "Not now".
  - No copy claims legal compliance (AGENTS legal rule).
- `components/PeopleMapCard.tsx`: a card for AccountScreen headed "Map". It has the toggle "Show my spot to my people", the line "Off: you're hidden (ghost)", and a "Hide me now" button that calls `clearMapSpot` and `setMapSharing(false)`. Status comes from `getMapSharing()`.
- `screens/AccountScreen.tsx`: render `<PeopleMapCard style={card} />` just above `<BlockedPeopleCard>` (L398). Hide it for guests.
**Accept:** toggling on writes `map_sharing.share_live=true` with `consented_at` and `notice_version='v1'`. Off deletes the `map_spots` row (check in SQL editor on staging). Permission denied leaves it off.

### WP4b: "My people" layer (depends on WP3, WP4a, WP6)

- `components/NearMap.tsx`:
  - Layer chips row (only when `onLayer` is given): **Jobs**, **Helpers**, and **My people** when `useAuth().userId` is set. Guests never see the chip.
  - Layer `mine` calls `mapPeople(centre, radius)` on mount, every `PEOPLE_POLL_MS` while focused (`useIsFocused` on native via the existing focus tick; `inFront()` on both), and on "Search this area".
  - Empty states:
    - Caller not sharing: "Your people show up here when they share their spot. Share yours?" plus a button that opens `PeopleMapSheet`.
    - No one sharing: "None of your people are sharing right now."
  - Pin tap opens `PersonSheet` (existing) for that id, with "Active now / Away" from `presenceOf`.
- `components/mapPins.ts`: `minePin(p: MapPerson, now)` → `JobPin` with `face: { initials: initialsOf(p.display_name), live: presenceOf(p.last_seen_at, now).online }`, `label: firstName`, and `area` omitted. Names are allowed here and only here (unlike D13 helper pins), because these people already know each other. Use `tone='people'`. **No edits to JobsMap\* or MapMarkers.**
- `components/NearMapParts.tsx`: `PersonRow` for the sheet list ("Asha · 2 jobs together · Active now · 1.2 km"), and `MapNotes` text for `mine`: "Spots are rounded to about 500 m and vanish after 15 minutes."
- "My pin": your own pin is the existing `me` marker. With sharing on, `me` is your own snapped cell from `useMapSpot`, otherwise your chosen area, as today.
**Accept:** two-account test (see (f)). The pin sits on a cell centre, not the real spot. Stops polling when the tab is left (network panel quiet).

### WP7: e2e

- `e2e/ui.spec.ts` "a task can be opened from the feed": after clicking Explore, click the `List` pill (`getByRole('button', { name: 'Show the list' })` or the label you set), then expect `₹`.
- `e2e/map.spec.ts`:
  - (1) Explore shows the map (expect the "List" control and the layer chips).
  - (2) List ↔ Map toggles.
  - (3) Guest: no "My people" chip.
  - (4) Home search → Explore opens in list with the query.
  - (5) Desktop project: the SideNav is visible next to the map.

---

## (d) Migration 159 SQL outline + RLS

File: `supabase/migrations/20261108120000_159_people_map.sql`. Forward-only and additive, so it is safe to auto-apply.

```sql
-- 159 -- People map (plan D20): opt-in rounded spots, seen only by people you finished a task with.

create table if not exists public.map_sharing (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  share_live     boolean not null default false,
  notice_version text    not null,
  consented_at   timestamptz,
  withdrawn_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create table if not exists public.map_spots (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  cell_lat   double precision not null check (cell_lat between -90 and 90),
  cell_lng   double precision not null check (cell_lng between -180 and 180),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists map_spots_expires_idx on public.map_spots (expires_at);

alter table public.map_sharing enable row level security;
alter table public.map_spots   enable row level security;
revoke all on public.map_sharing, public.map_spots from anon, authenticated;
grant select on public.map_sharing to authenticated;
drop policy if exists map_sharing_own on public.map_sharing;
create policy map_sharing_own on public.map_sharing for select to authenticated using (user_id = auth.uid());
-- map_spots: no policy, no grant. Only the security-definer functions below touch it.

create or replace function private.snap_cell(p double precision) returns double precision
  language sql immutable as $$ select round((round(p / 0.005) * 0.005)::numeric, 3)::double precision $$;

create or replace function public.map_sharing_set(p_on boolean, p_notice text) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_on and not exists (select 1 from age_checks where user_id = v_me and passed) then
    raise exception 'Only adults can share a spot' using errcode = '42501'; end if;
  if p_on and exists (select 1 from profiles where id = v_me and deleted_at is not null) then
    raise exception 'Account closed' using errcode = '42501'; end if;
  insert into map_sharing (user_id, share_live, notice_version, consented_at, withdrawn_at, updated_at)
  values (v_me, p_on, coalesce(p_notice,'v1'), case when p_on then now() end, case when not p_on then now() end, now())
  on conflict (user_id) do update set share_live = excluded.share_live, notice_version = excluded.notice_version,
    consented_at = case when p_on then now() else map_sharing.consented_at end,
    withdrawn_at = case when p_on then null else now() end, updated_at = now();
  if not p_on then delete from map_spots where user_id = v_me; end if;
  return jsonb_build_object('share_live', p_on);
end $$;

create or replace function public.map_spot_beat(p_lat double precision, p_lng double precision) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := auth.uid(); v_lat double precision; v_lng double precision;
begin
  if v_me is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return; end if;
  if not exists (select 1 from map_sharing where user_id = v_me and share_live) then return; end if;
  v_lat := private.snap_cell(p_lat); v_lng := private.snap_cell(p_lng);
  insert into map_spots (user_id, cell_lat, cell_lng, updated_at, expires_at)
  values (v_me, v_lat, v_lng, now(), now() + interval '15 minutes')
  on conflict (user_id) do update set cell_lat = excluded.cell_lat, cell_lng = excluded.cell_lng,
    updated_at = now(), expires_at = excluded.expires_at
  where map_spots.updated_at < now() - interval '50 seconds'          -- server-side throttle
     or map_spots.cell_lat <> excluded.cell_lat or map_spots.cell_lng <> excluded.cell_lng;
end $$;

create or replace function public.map_spot_clear() returns void
  language sql security definer set search_path = public, pg_temp as $$ delete from map_spots where user_id = auth.uid() $$;

create or replace function public.map_my_people(p_lat double precision, p_lng double precision, p_radius_km double precision)
returns table (id uuid, display_name text, avatar_url text, last_seen_at timestamptz,
               lat double precision, lng double precision, km double precision, jobs int, spot_at timestamptz)
  language sql stable security definer set search_path = public, pg_temp as $$
  with me as (select auth.uid() as uid),
  pairs as (
    select a.worker_id as other from tasks t join assignments a on a.task_id = t.id, me
     where t.poster_id = me.uid and t.status in ('COMPLETED','AUTO_COMPLETED')
    union all
    select t.poster_id from tasks t join assignments a on a.task_id = t.id, me
     where a.worker_id = me.uid and t.status in ('COMPLETED','AUTO_COMPLETED')
  ),
  people as (select other, count(*)::int as jobs from pairs, me where other <> me.uid group by other)
  select p.id, p.display_name, p.avatar_url, p.last_seen_at, s.cell_lat, s.cell_lng,
         -- haversine km; reuse an existing private distance helper if one exists
         6371 * 2 * asin(sqrt(power(sin(radians(s.cell_lat - p_lat)/2),2)
           + cos(radians(p_lat)) * cos(radians(s.cell_lat)) * power(sin(radians(s.cell_lng - p_lng)/2),2))) as km,
         pe.jobs, s.updated_at
    from people pe
    join profiles p     on p.id = pe.other and p.deleted_at is null and p.onboarded_at is not null
    join map_sharing ms on ms.user_id = pe.other and ms.share_live
    join map_spots s    on s.user_id = pe.other and s.expires_at > now()
    , me
   where me.uid is not null
     and not exists (select 1 from blocks b where (b.blocker_id = me.uid and b.blocked_id = pe.other)
                                              or (b.blocker_id = pe.other and b.blocked_id = me.uid))
     and p_radius_km between 0 and 50
   order by km limit 50
$$;
-- (wrap the select to filter km <= p_radius_km; outline only)

-- A closed account (soft delete, migration 087) stops sharing at once.
create or replace function private.map_forget_closed() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from map_spots where user_id = new.id;
    update map_sharing set share_live = false, withdrawn_at = now(), updated_at = now() where user_id = new.id;
  end if; return new;
end $$;
drop trigger if exists map_forget_closed on public.profiles;
create trigger map_forget_closed after update of deleted_at on public.profiles for each row execute function private.map_forget_closed();

revoke all on function public.map_sharing_set(boolean,text), public.map_spot_beat(double precision,double precision),
  public.map_spot_clear(), public.map_my_people(double precision,double precision,double precision) from public, anon;
grant execute on function public.map_sharing_set(boolean,text), public.map_spot_beat(double precision,double precision),
  public.map_spot_clear(), public.map_my_people(double precision,double precision,double precision) to authenticated;
revoke all on function private.snap_cell(double precision), private.map_forget_closed() from public, anon, authenticated;
comment on table public.map_spots is 'People map (D20): one rounded cell per sharer, 15 min life. Never exact.';
```

The builder must confirm, before writing:
- the real column names (`assignments.task_id`, `worker_id`; task statuses). Copy them from `myRegulars` in reads.ts L527.
- whether a haversine helper exists (`grep -rn "haversine\|distance_km" supabase/migrations`).
- that the `api` function calls RPCs with the **user's** JWT, so `auth.uid()` is the caller. Check how `rpcOp` builds `ctx.db`. If it uses the service key, pass `p_user` from `ctx.userId` and check it server-side instead.

No pg_cron, no Inngest job. There is one row per user (upsert), expired rows are filtered on read, and off/closed deletes the row. Account hard-delete cascades through `auth.users`.

---

## (e) Privacy rules (must hold; each one is tested)

1. **Opt-in only.** `share_live` defaults to false. Consent is stored with `consented_at` + `notice_version`. Withdrawing takes one tap and deletes the spot immediately (DPDP: withdrawal as easy as consent).
2. **Never exact.** The device snaps to a 0.005° cell before sending and the server snaps again. Exact device coordinates are never stored, logged or sent to another user. `profile_private` / `task_private` are never read by any new code.
3. **Seen only by "my people"** (decision 4), never strangers, never guests (no guest op, no anon grant). Blocking either way hides at once.
4. **Stale after 15 min.** No history: one row, overwritten.
5. **Adults only.** `age_checks.passed` is required to switch on (age gate 18, migration 082). Guest mode (D15) has no way to share or view.
6. **Foreground only.** The location permission is requested only from the consent sheet. No background permission, no beats while the app is in the background or closed.
7. **Closed account = gone.** The soft-delete trigger and the hard-delete cascade remove it.
8. **Strangers' layers unchanged.** Helpers and jobs keep using the public 2-decimal area (migration 074) and D13's no-names helper pins.
9. **Logs.** No lat/lng or names in `log()`/Sentry. Run `lib/scrub.ts` checks. The API logs only op names.
10. **Privacy page.** Add a "People map" paragraph to the Privacy screen draft after the owner approves (copy goes to legal review. Do not claim compliance).

---

## (f) Tests and verification checklist

**Automated (all must pass):**
- `npm run check` (typecheck + lint + unit: `mapSpot.test.ts`, `registry.test.ts`, `tour.test.ts`, api `api.test.ts`/`contract.test.ts`).
- `npm run test:db` with `supabase/tests/people_map.test.sql`:
  - A and B finished a task, B shares, so A sees B **at the cell**: assert `lat = round(x/0.005)*0.005`, never B's input.
  - C (stranger) sees nothing.
  - Either-way block hides B.
  - An expired spot hides B.
  - B turning off deletes the row.
  - anon cannot execute any RPC.
  - authenticated cannot `select` `map_spots`.
  - An under-18 cannot switch on.
  - Soft-deleting B removes the row.
  - The beat throttle: two beats within 50 s, same cell, leave `updated_at` unchanged.
- e2e (`e2e/ui.spec.ts`, `e2e/map.spec.ts`) against the localhost export.

**Web (localhost; Vercel previews cannot sign in):**
1. `npx expo export -p web` in `apps/mobile`, then serve `dist` on `http://127.0.0.1:8099` (`e2e/serve-dist.mjs`).
2. Phone width 390×844 and desktop 1440×900, light and dark:
   - Explore lands on the full map.
   - The tab bar/SideNav is visible.
   - List/Map toggles both ways.
   - Hire ↔ Earn flips the layer.
   - The remote-jobs line opens the list on the Remote filter.
   - Home search lands in List.
   - Home's NearYou "open map" still opens the `nearMap` route with its X.
3. Guest (signed out → guest): map shows Jobs/Helpers, no My people chip, no Account card.
4. Two accounts (two browser profiles) that share a COMPLETED task on staging:
   - B turns sharing on.
   - A sees B's face pin within 60 s.
   - B's network payload shows `spot` multiples of 0.005.
   - B taps "Hide me now", and B is gone from A's map on the next poll.
   - A blocks B, and B is gone.
5. Network: with the Explore tab left, no `mapPeople` calls. Home first load unchanged (Explore is not the start screen).
6. Reduced motion (OS setting): the toggle uses the short fade.

**Android (device CPH2585):**
1. Expo Go over USB: `adb reverse tcp:8081 tcp:8081`, `npm run android`. Expo Go uses the tile map (no Maps key in Expo Go), the same code path as web.
2. Check:
   - Explore tab shows the map above the native tab bar.
   - The sheet drag works.
   - Back button behaviour unchanged.
   - Earn mode label is "Find work" with the map icon.
   - Location permission prompt appears only from the consent sheet.
   - Background the app for 15 min, and the spot disappears for the other account.
3. Google Maps (react-native-maps) only in an installed build: needs an EAS build, which is an **owner approval** item. Do not publish OTA/EAS without asking (AGENTS rule 7).

---

## (g) Risks and what could not be verified

**Risks**
- **R1 Tile cost and policy (web + Expo Go).** The web map pulls tiles from `tile.openstreetmap.org`. Making the map the Explore landing multiplies tile loads, and OSM's public tile policy does not allow heavy app traffic. This is fine for ~10 staging testers. For production the owner must pick a provider (decision 35c). The tile URL lives in one function (`tileUrl`), so swapping it is a one-line change plus a key in the server env and a referrer allow-list.
- **R2 Android Google Maps quota.** Installed builds use the Maps SDK for Android (`EXPO_GOOGLE_MAPS_API_KEY`, app.config.js). Dynamic maps on the mobile SDK are believed to carry no per-load charge. This was not checked in the console. The memory notes say the Android Maps key restriction is still open.
- **R3 Stalking via repeated observation.** A 550 m cell shown live can still narrow down a home over days. It is mitigated by the 15 min expiry, ghost mode and blocks, and (since 35b) strangers only see a coarser ~2 km cell and only for people who chose "Everyone nearby".
- **R4 KEEP_ALIVE + view reset.** Explore stays mounted, so the "reset to map on re-entry" logic must key off the focus tick and not fight the list intents. This is covered by the e2e case (4).
- **R5 Migration auto-apply.** Merging WP1 applies it to staging immediately. Keep it additive. If a later fix is needed, ship a new migration (forward-only).
- **R6 Desktop FULL change.** Moving `explore` into `FULL` makes the list view responsible for its own max width. Compare against today's widths at 1024, 1440 and 1680.

**Not verified while writing this plan (the builder must check):**
- That native-tabs Android really refuses a 6th item. This rests on the Material BottomNavigationView 5-item limit and was not run here. It does not change the recommendation.
- Exact `assignments`/`tasks` column and status names for the SQL (copy them from `myRegulars`).
- Whether `rpcOp` runs with the user JWT (`auth.uid()` set) or the service key.
- That `PersonSheet` accepts an id the way the plan assumes, and that `MapMarkers` `FacePin` renders initials when `icon` is absent.
- SF Symbol `map`/`map.fill` and Material `map` names in `expo-router/native-tabs` (iOS is deferred anyway).
- Google Maps pricing (R2) and OSM tile policy specifics (R1).
- Nothing was run: no app, no tests, no DB queries. This is a code-reading plan only.
