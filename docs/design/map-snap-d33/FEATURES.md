# D33 keeps every map feature (owner, 26 Nov)

Source: code audit of apps/mobile/src + migrations 074/160 (26 Nov). "Today" = what users see now. "In D33" = how the new fast map keeps it.

## Privacy (never weaken)
1. Approximate task spot | DB rounds task location to ~1.1 km; exact spot private | Same fields, same rounding. Tap a pin -> soft "Approximate area" circle. Never exact coordinates in the map data.
2. Approximate helper spot | Same ~1.1 km rounding | Same.
3. My people spot | Phone + server snap to ~550 m; strangers see ~2 km cell; 15 min expiry | Unchanged (useMapSpot / mapSpot untouched).
4. Helpers anonymous until tap | Service icon only, never name or photo on the map | Kept. Photo appears only in the sheet after tap.

## Zoom
5. Zoomed out = best offer per area | A group shows ONE price pin with the area's highest offer + count | Native clusters carry the max offer: chip "Rs 1,200 +8".
6. Zoomed in (zoom 14+) = every task | Group spreads on rings, one pin each, soft circle behind | Same rings, now animated outward ("burst"); folds back on zoom out.
7. Tap a group = fly in | Map flies to zoom 14+ | Smoother flyTo (~600 ms).
8. Grouping distance | 80 px tasks / 96 px people | Same numbers as native cluster radius.

## Layers + colours
9. Earn = tasks only, royal blue. Hire = helpers only, jade | Kept exactly.
10. My people layer (signed-in adults; finished-task people + opted-in strangers; 60 s refresh) | Kept as a layer chip.
11. Share my spot card (switch + people/everyone, notice first) | Kept.

## Pins
12. Helper pin = service icon, white rim, green "active now" dot; stacks of up to 3 + "+N" | Kept; dot gets a soft pulse (new).
13. Helper pin text = top service + "from Rs" + "More" | Kept.
14. Task pin (zoomed in) = poster face + name + price | Kept.
15. Best offer on screen takes the mode colour; City Hunt pins keep their label | Kept.
16. Labels never overlap each other, You marker or buttons | Native label collision does this.

## Taps + panels
17. Tap helper -> helper sheet; tap task -> job card (bottom card on phone, callout on desktop); tap person -> person sheet | Kept.
18. Pull-up bar resting on best offer / nearest helper; drag, tap or wheel to open list | Kept.
19. Desktop: full-width map + side panel (can minimise) + one-time "scroll or pinch to zoom" tip | Kept.

## Location + reach
20. You marker ("You" live / "Your area" saved) | Kept.
21. Location sheet: search places, use live spot, open settings; guests keep area on device | Kept.
22. Reach 5/10/25 km + custom 1-100 km; map fits the circle; people capped 50 km | Kept.
23. Reach ring drawn on the map | Kept (dashed ring).

## Filters + data
24. Filters shared with the list: price, Nearby/Remote/All, how they hire, due soon, sort | Kept (same store).
25. Explore search text also filters map pins | Kept.
26. Remote jobs: no pin, counted in list only | Kept.
27. Loads 200 newest tasks; refresh 600 ms after the map stops; 5 min cache | Kept (same refresh rules).

## Motion
28. Heat glow under job areas | Kept (native heat layer, cheaper).
29. "Just posted" ripple (under 15 min, max 2, every 3.6 s) | Kept.
30. Pins fade + scale in, staggered | Kept.
31. Reduced motion respected | Kept: moves become instant, ripples/pulse off.

## Other
32. Topped-up badge on job row + card | Kept.
33. Guests: helpers map only, My people off, area on device | Kept.
34. Dark mode (dark map style, dark pin tags) | Kept; phone now uses the same dark style as web.
35. Map picker when posting / choosing area | Moves to the same engine, same behaviour.
36. Home map previews + map shortcut chips | Kept (open the map on that layer).
37. Expo Go / web fallback tile map | Kept as fallback.

## New in D33 (the actual upgrade)
- Native engine on phone (same as web): thousands of pins at smooth 60 fps, no React view per pin.
- Same map look on web and phone; no Google Maps key in the Android app.
- Animated cluster burst + fold, smoother fly-to, pulse on active dot.
- 3D buildings at street zoom (16+), if you say yes.

## Build gotchas (for the build steps)
- Many tasks share one rounded point: native clusters cannot split identical points, so keep the ring spread step (lib/mapLayout.ts ringSpots) and feed spread spots into the layer at zoom 14+.
- Cluster must carry max offer (clusterProperties max) + face/service data for stacks.
- MapLibre RN zoom is 1 off the 256 px tile maths (GL_TO_TILE); keep mapReach / zoomToFit right.
- Keep NearMap picked-id state, sheet offsets (leftInset, HELPER_SHEET_H), onMoveEnd refresh, fit-to-reach.
- Guests must never call the map_people_around path (NEEDS_ACCOUNT).
- Native change = new local Android build (C:\tdb, lb.mjs), not OTA.
