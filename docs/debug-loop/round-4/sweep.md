# Round 4 sweep (13 Nov 2026, read-only)

Branch redesigned-2.0 at e579a29. Nothing edited, committed, migrated or reseeded. Only build output written: `apps/mobile/dist` (gitignored) and Playwright `test-results/` (gitignored).

| Check | Run 1 | Run 2 | Notes |
|---|---|---|---|
| user `npm run check` (typecheck, lint, test) | green | green | 515 + 123 unit tests pass both times; turbo 4/4 and 5/5 tasks; only Node MODULE_TYPELESS_PACKAGE_JSON warnings (noise) |
| user `npm run test:contract` | green | green | 100 old-app operations compared, 74 answered with sample arguments |
| user `npm run audit:gate` | green | green | 3 moderate advisories (glob, minimatch, uuid), all accepted, review by 2026-12-13 |
| admin `npm run typecheck` | green | green | |
| admin `npm run lint` | green | green | |
| admin `npm test` | green | green | 169/169 |
| admin `npm audit --omit=dev` | 0 vulns | 0 vulns | |
| admin `npm run build` | green | (once) | prebuild env check passed; scan-build: 38 files, no secret |
| user `npm run test:db` | NOT RUN | NOT RUN | `psql` not installed on this machine and `DATABASE_URL` is not in the shell (the script does not read `.env.all-secrets` itself). Needs psql + owner-provided env |
| user `npm run test:e2e` | RED (partial) | RED (subset) | Run 1 was cut off at test 34 of 68 (session interrupted); run 2 re-ran accounts.spec + map.spec with 30 s timeout: identical failures, so deterministic, not flaky |

## Debug lines
`[DBG-` search in both repos (excluding node_modules, docs, .next, .git, graphify-out, dist, test-results): none found.

## E2E findings (target: staging test project wjxvingpfbfvkfqhrguj, fake seed accounts, no payment pages touched)
Setup project (uptime, sign in Asha/Ravi/Meera, tidy) passed both runs. `dist` was stale and had no index.html, so `npm run web:export` was run first (exit 0, staging build).

1. E2E-1 accounts.spec.ts tests at lines 30, 81, 94 (new phone sign-up, under-18 turned away, existing account sign-in). Error: `locator.fill: Timeout waiting for getByPlaceholder('98765 43210')` in `askForCode` (accounts.spec.ts:19, `page.goto("/")`). Page snapshot shows the guest landing page (How-it-works steps, "Sign in" button), no phone field. Verdict: broken test (guest mode D15: "/" no longer opens the phone form). Fix is in e2e/accounts.spec.ts askForCode (click Sign in first). Real sign-up not proven either way, so worth a manual check.
2. E2E-2 map.spec.ts signed-in poster tests at lines 36, 58, 75, 88 and guest tests at 127 and 214 (List/Map pills, side panel hide, distance in Filters, From home switch, guest reach, List view empty box). Error: plain test timeout, no assertion text; page snapshot shows the signed-in Explore screen. Verdict: unknown, probable broken selectors after D23 (filters sheet, from-home jobs) or after the Explore redesign; could also be a real UI regression. Needs a look at the trace (`test-results/map-signed-in-as-the-seed--0e049-*/trace.zip`). Files: e2e/map.spec.ts, helpers showList/showMap.
3. E2E-3 map.spec.ts D21 zoom tests at lines 165, 179, 192, 200 (guest wheel, Ctrl+wheel pinch, double-click, drag west). Error: `expect(zoomedIn).toBeGreaterThan(before)` Expected > 4, Received 4 (zoom never changes). Verdict: unknown. Either headless Chromium without WebGL so MapLibre does not respond, or a real zoom regression after MapLibre 6.15 / D23 whole-world change. Owner should test wheel zoom on taskdrop.in by hand to tell which.
4. Flaky tests: none seen (no pass-then-fail).

## Not run
- The rest of the e2e suite: breakit.spec (all 12 skipped in run 1, they depend on setup state), money, monkey, notifications, rules, tour, ui, mapPeek, mapPeople never reached because run 1 was interrupted and run 2 was limited to the failing files. Re-run needed before calling e2e covered.
- `test:db`: see table.
- `DATABASE_URL` unset, so e2e global teardown did not clear "[e2e]" alerts on the test accounts (harmless leftovers on staging).
