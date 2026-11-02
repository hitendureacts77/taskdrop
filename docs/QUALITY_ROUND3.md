# Quality tests, round 3 (plan task 3.6): what was run on 2 November 2026

Staging only (fake money, fake data). Run by Claude from the owner's PC. **Part done:** the website and server parts. The phone parts need the Android phone connected (it was not) and are listed at the end.

## T9 Speed: the website (Lighthouse 12.8, `https://taskdrop.in`, which still serves staging until task 5.10)

| | Phone-sized (throttled) | Laptop |
|---|---|---|
| Performance | **35** | **62** |
| Accessibility | **100** | **100** |
| Best practices | 96 | 93 |
| SEO | 63 | 63 |
| First paint | 2.5 s | 0.9 s |
| Biggest content shown | **11.5 s** | 2.5 s |
| Blocked by scripts | 1.7 s | 0.34 s |
| Layout jumps | 0.01 | 0.006 |

What the numbers mean:

- **One script is the whole problem.** `index-….js` is 1.3 MB; the page waits about 7 s after it arrives before the first screen is drawn. The phone-sized run slows the processor on purpose (it models a mid-range phone), so this is the worst case, but it is the case that matters for people on cheap phones opening the website. The Android app is not affected (it is a native app).
- **Accessibility is 100** on both sizes: every automatic accessibility check in Google's tool passes on the screen it loads (the sign-in screen).
- **SEO 63 is on purpose.** Staging tells Google not to list it (`noindex`). See finding F3: production must not.
- **Source maps return 403** to the public. Good: the code is not published for copying; Sentry has its own copy.
- The one console error on the laptop run is Vercel's own preview toolbar being refused by the page's (report-only) security policy. It exists only on preview builds, not in production.

## T9 Speed: the server (`node scripts/load-test.mjs`, new in this task)

Reads only, three seed people at once, 4 at a time each.

| Phase | Result |
|---|---|
| 1. Ordinary load: 180 reads in 17 s | **No errors.** Median 1.0 s, 95th percentile 1.9 s, slowest 5.7 s (a cold start) |
| 2. One person sends 330 reads in a minute | **300 answered, 30 refused with 429** (the budget is 300 a minute). No 5xx, no network error |

Median times are from this PC to Mumbai with 12 requests in flight, so they are slower than a single warm call (about 0.4 s, `docs/API_CALLS.md`). The point is that load changes the time, not the correctness: nothing failed, and the limiter refused exactly the reads over the budget.

Request counts per screen were measured on 29 October and 2 November and are in `docs/API_CALLS.md`; they were not repeated.

## Findings (Critical and High: none)

| # | Level | Finding | Needs from you |
|---|---|---|---|
| F1 | **Medium** | The website's first load is slow on a phone-class processor (performance 35, biggest content after 11.5 s) because the whole app is one 1.3 MB script. Fixes: split the script so only the first screens load at once, and check the host compresses it. This is real work, not a quick change | **Fix or accept.** If most early users come through the Android app, accepting for now is reasonable; revisit when the public pages (4.3) exist, because Google ranks pages on this score |
| F2 | Low | The "Continue with Google" button shows "G Google" but its spoken label is "Continue with Google". Google's check wants the spoken name to contain the visible text | Fix or accept. A one-line change either way |
| F3 | **Launch trap** | `vercel.json` tells Google not to list `taskdrop.in` and `www.taskdrop.in` (`X-Robots-Tag: noindex`). That is right while those names serve staging, but they become **production's** names in 5.10. If the file is promoted to `main` unchanged, the real website stays hidden from Google | Nothing now. Added to the plan as proofs in 5.10 and 5.11: the two `taskdrop.in` rules are removed from `vercel.json` before production goes live, and the live site must answer with no `noindex` |
| F4 | Info | Vercel's preview toolbar breaks the report-only security policy on preview pages | None. Not present in production |

## Not done in this round (and why)

- **Speed on the phone** (cold start, scrolling): the phone was not connected.
- **T10 every screen at every phone size, light and dark, with a screen reader:** the automatic end-to-end tests already run the website at laptop and phone width, and Lighthouse passed accessibility on the sign-in screen. A pass over every screen in light and dark, and on the phone with TalkBack, was not run.
- **T12 Recovery:** what the app shows when SMS, payments or photos are down was not re-tested in this round, and the **nightly database copy script** (needed for the practised restore in 6.5) is not written yet.

Re-run the measurements any time with:

```bash
npx lighthouse https://taskdrop.in --only-categories=performance,accessibility,best-practices,seo
node scripts/load-test.mjs
```
