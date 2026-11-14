# Round 4, charter E: live admin walk (admin.taskdrop.in, staging)

Date: 13 Nov 2026, 11:35 am to about 12:00 pm IST. Owner's account (role Admin), Claude in Chrome, own tab. Viewport stayed at 767 px wide (the window resize call did not take), so every page was seen at tablet width, not desktop.
Phone numbers, emails and UPI ids are scrubbed below. Static code findings are in `admin.md` (another agent); this file is the live side only.

## Actions I took on staging (all on fake seed data, all undone)

| Time | Action | Undone |
|---|---|---|
| 11:42 | Added tag `=1+1` to Deepika Siddiqui (fa4e0001-...05f), checked the CSV, removed the tag | yes |
| 11:43 | Suspended the same person (reason with `<b>`, quotes, `=`), then let her back in | yes |
| 11:41-11:44 | People CSV export, 3 times | n/a (read only) |
| 11:45 | Service fee editor: tried `abc` and `-1` (both refused by the server, nothing saved) | n/a |
| 11:46 | Add-rule form with client checks off, days = 500 (refused by the server, nothing saved) | n/a |
| - | Opened (and cancelled) the record-payment form, the dev sign-in switch confirm, the authenticator switch confirm, the suspend dialog | n/a |

## Bugs

### R4-L1 High (Backend) Jobs list paging skips 280 of 748 jobs and repeats others
- Page: `/tasks` (All jobs). Steps: open `/tasks`, press "Older" through every page (page=0..24).
- Current: 748 rows are shown across the 25 pages, but only **468 distinct jobs**. Page 2 repeats 19 of page 1's 30 jobs. 280 jobs can never be reached by paging. Page 1 itself is stable between loads.
- Expected: every job appears exactly once.
- Proof: fetched each page's HTML and collected `/tasks/<uuid>` links: `rows seen 748 unique 468`; `p1 30 p2 30 overlap 19`. The People list does not have this problem (198 seen, 198 unique).
- Likely cause: ordered by "last change" only; the 120-person fake seed wrote hundreds of jobs with the same timestamp, so `range()` paging over a non-unique sort key is unstable. Add a tie-breaker (`id`) to the order. Likely file: the jobs list query in the admin repo `app/tasks/page.tsx` (or its data helper).

### R4-L2 High (Both) Pay screen sends money to a different UPI id than the one the withdrawal was made to
- Page: `/payouts/d1b4a6d3-...` (Ravi seed worker, ₹600). Steps: Payouts, press Pay on Ravi's row.
- Current: step 1 (QR code, "UPI" + Copy) shows `ravi.e2e@okaxis`; the Details box on the same page says "Sent to `seed.ravi@upi`". The QR and copy button pay the first one. No warning that they differ.
- Expected: the admin pays the destination saved on the withdrawal (or the page clearly says the person changed their payout id since asking, and asks which to use).
- Risk: with real money, a worker who changes UPI after asking (or someone who took over the account) gets paid to the new id.
- Also on the same Details box: "Paid: By RazorpayX" on a manual, unpaid withdrawal (RazorpayX is not set up). Should read "Not paid yet" / "By hand".

### R4-L3 Medium (Both) People page and CSV: Phone empty, phone number shown unmasked inside the "Email"
- Pages: `/users/<id>` Contact box; `/api/crm/export` (People, Download spreadsheet).
- Current: for all 170 phone sign-ups the Phone field is "—" and the Email field shows the internal sign-in address `p<10-digit phone>@phone.taskdrop.app`. In the CSV the Phone column is empty for all 198 rows; the Email column carries the full phone number for 170 rows (120 of them the fake 98880 numbers). 19 deleted accounts (`@deleted.taskdrop.app`) are also in the "Everyone" export.
- Expected: Phone shows the phone (masked in the list/CSV unless the admin asks to reveal), Email shows a real email or "—"; deleted accounts left out unless the Deleted filter is chosen.

### R4-L4 Medium (Backend) Audit gaps: person Audit tab empty, "opened a person page" has no target, tag changes not logged
- Steps: on Deepika's page add then remove a tag, suspend and unsuspend her, then open her Audit tab, then Admin & configuration, Audit log.
- Current:
  - Person page, Audit tab: "Nothing recorded", although the global log has "Added suspensions" with `after.user_id = fa4e0001-...05f` and "Changed suspensions".
  - Global log rows "Opened a person page with phone and email showing" (6 of them) have before/after `null` and link only to the admin: the log never says whose phone/email was seen.
  - Adding and removing the tag `=1+1` wrote no audit line at all.
  - "Added suspensions" / "Changed suspensions" do not name the person in the "What happened" column; the row links to the admin, not the person.
- Expected: each staff action names its target and shows on that person's Audit tab; tag changes are logged (SECURITY_ROLES lists tags as a People change). This is the H77-H80 area (admin security events): the PII-view event exists but is not usable.

### R4-L5 Medium (Both) Payouts: "Settled" says 10 paid for ₹12,650 in the last 30 days, the Paid tab says 0
- Page: `/payouts`, Settled section. Steps: open Payouts, look at Settled, press "Paid".
- Current: "Last 30 days · paid in total ₹12,650.00 (10)." next to tabs "All 25 · Paid 0 · Came back 0 · Cancelled 25"; the Paid tab says "Nothing here in the last 30 days". The dashboard shows the same ₹12,650 as "In total · 10 payouts".
- Expected: the summary line and the tab counts use the same window (either both all-time or both last 30 days).

### R4-L6 Medium (UI) "Ready to withdraw" includes earnings still clearing
- Pages: `/payouts` top card and Money position.
- Current: "Ready to withdraw ₹1,58,146.00 — Earnings people can still ask for" and, lower, "Earnings plus withdrawals on the way ₹1,58,146.00". ₹1,58,146 = ready ₹1,43,301 + clearing ₹9,945 + on the way ₹4,900 (from the Earnings page). Clearing money cannot be asked for, and money on the way has already been asked for.
- Expected: ₹1,43,301 for "can still ask for", or relabel the sum.

### R4-L7 Medium (UI) Cancelled job's timeline says "Approved, money released"
- Page: `/tasks/2df4cd47-...` ("Bookshelf assembled at home", status Cancelled, never hired).
- Current: Timeline shows "Approved, money released 13 Nov, 11:39 am" (the cancel time); "Where the money is now: nobody is hired yet".
- Expected: a "Cancelled" step, and "Approved" left at "Not yet".

### R4-L8 Medium (UI) Turning on "Authenticator code for money actions" does not warn that no admin has one
- Page: Admin & configuration, App switches. Team tab says "Authenticator set up 0 of 6".
- Current: the confirm says only "Every admin must enter an authenticator code before moving money"; one click on "Turn on" would block every money action for all 6 staff (and maybe turning it back off). Not confirmed by me.
- Expected: refuse or warn loudly when 0 admins (or not the current admin) have an authenticator.

### R4-L9 Medium (UI) Money check hides the oldest stuck withdrawals by default
- Page: `/money/reconcile`. Default window "Last 30 days".
- Current: "Withdrawal waiting too long: 2" while 7 withdrawals are waiting 13 to 40 days; the 4 oldest (39-40 days) only appear under "Last 90 days" (which says 6, still not 7). The window filters by the date asked, so the worst cases drop out first.
- Expected: open problems (still waiting) always listed whatever the window; the window only for closed history.

### R4-L10 Low (UI) Jobs search: total "held" ignores the search, and `%` / `_` match everything
- Page: `/tasks`. Steps: Money held, search `%_'"<b>x</b>,()\`.
- Current: "0 jobs · ₹33,681.00 held in escrow for them". Searching `%` or `___` returns all 748 jobs (LIKE wildcards not escaped). Special characters render safely; no errors.
- Expected: the held sum follows the search; `%` and `_` searched literally.

### R4-L11 Low (Backend) CSV dates are UTC, the screen is IST
- Deepika: page says "joined 5 Nov" (03:47 am IST); CSV says `2026-11-04`. Same for Last seen.
- Expected: CSV in India time like the screen (or column header says UTC).
- (Good: a tag `=1+1` came out as `'=1+1` in the CSV: formula cells are neutralised.)

### R4-L12 Low (UI) Record-payment reference accepts a single space
- Page: Pay screen, "Paid by UPI". The UTR box is `required` with no pattern: `" "` and `x` pass the browser check. Server side not tested (would record a payment). Expected: trim and require a UTR-shaped value (12 digits for UPI).

### R4-L13 Low (Backend) Audit log flooded by a system line every 10 minutes
- 1,385 audit lines, almost all "The system · Settings · Changed public_snapshots_last_ok". Staff actions are buried; there is no "staff only" default view. Expected: heartbeat values not written to the audit log, or hidden by default.

### R4-L14 Low (UI) Status contradictions
- System health says "Everything is working" while Money check shows 14 differences ("Finished with no commission booked", 75 in 30 days, 154 in 90; mostly fake-seed jobs).
- Team tab: "Authenticator ... needed to move money" and "changing someone's role asks for your authenticator code", but the switch is Off and nobody has one, so neither is true today.
- Payouts row 1 (workerPro ₹300, 40 days) still shows "You're paying" (claim lock never expires).
- Fake people: "last seen 13 days ago" while "joined 5 Nov" (seed data). List says "Worker" while the person page says "Worker · Poster".
- Devices: iPhone "100% on the latest version (1.0.0)" while the app is 1.1.0.

## Seen, not a bug here (for the other agents)

- A job "Bookshelf assembled at home" with a budget of **₹9,99,99,999.00** was posted at 11:37 by Tasker 3313 (the Android explorer). The admin shows it correctly; the app accepted the amount. That is a user-app/server limit question, see the Android notes.
- Text `${7*7}{{7*7}}<%= 7*7 %>` (seed name) and `<b>` in the suspend reason render as plain text everywhere: no template or HTML injection.
- Dashboard numbers agree with the pages: escrow ₹33,681 = 49 rows on Earnings & escrow (summed); 28 hired = 26 + 2 unpaid; 30 "needs you" = 7 withdrawals + 23 disputes; commission + fee = total earned.
- Golden path: today's money rows are visible (4 jobs approved automatically at 7:15 pm on 12 Nov with commission and fee lines). No review rows are shown on the admin at all apart from star averages on People.
- Console: no errors on any page. One warning on every load: `[Sentry] beforeSendTransaction and ignoreTransactions are ignored with traceLifecycle: 'stream'`. If the admin's Sentry scrubbing lives in `beforeSendTransaction`, it is not running on performance data (H77-H80 area; check `instrumentation-client.ts` / `sentry.*.config.ts`).
- Server checks held: service fee `abc` ("Type a number.") and `-1` ("It can't be below 0."); rule days 500 ("Days must be a whole number from 1 to 90."); owner has no role dropdown on their own row.

## Pages covered

Dashboard, Needs you now, Earnings & escrow, Payouts (list, Paid filter, one Pay screen), Refunds (empty state), Money check (30 and 90 days), Jobs (all, overdue, money held, disputed, search, paging, one job), People (list, paging, CSV, one fake person: tags, suspend, audit tab), Admin & configuration: Team & access, Money & timing, App switches, Rules, Web/Android/iOS controls, Integrations, System health, Audit log.

## Not tested, and why

- Platform controls form (banner link `javascript:`, min version `abc`, past end date): the save was blocked by the session's permission check (changes app-wide shared settings). Needs the owner's go-ahead or the static review.
- App switches, maintenance mode, refunds, withdrawal approve, role changes, deleting people: dialogs opened and cancelled only, no confirm.
- Width 390 and real desktop width: the window would not resize; everything was seen at 767 px (top nav becomes a horizontal scroller with a visible scrollbar; nothing else broke).
- Dark mode: not offered in the panel.
- See the later sections for pages walked after this point.

## After the usage-limit pause (about 12:00 pm onward)

My tab had been closed during the pause. In a new tab, every admin page sends you to `/not-authorized`: "Signed in as <a non-admin Google account>, but that account is not an admin account." The browser now has a different (non-admin) Google account signed in to the panel. I did not cause this. The likely causes are the owner signing in to another account, or a Google sign-in started by another agent; there are two PKCE `code-verifier` cookies from a fresh Google flow on admin.taskdrop.in. `/login` goes straight to Google's account chooser. Choosing the owner's account there means signing in on Google's real sign-in page, which my rules do not allow, so **the walk stopped here**.

### R4-L15 Low (UI) "Not an admin account" page is a dead end
- Page: `/not-authorized`. Current: there is no Sign out or "Use another account" button; the only text says to sign in with the admin account. The person has to know to open `/login` by hand (which then shows Google's chooser, but no way to pick the @username + password option the Integrations tab describes).
- Expected: a Sign out button and links to both sign-in methods.

### Not walked because of the lost session

My security, Disputes (list and decide dialog), Reports queue, Alerts, Help requests, Copyright notices, Feedback board, Promotions, Customer hub, Follow-ups & pipeline, Leads, Segments, Messages, Business reports, Team performance, Devices; exports other than People; 390 px width; keyboard focus pass; double-click tests. To finish: the owner signs back in to admin.taskdrop.in as the admin account, then rerun charter E from "My security".
