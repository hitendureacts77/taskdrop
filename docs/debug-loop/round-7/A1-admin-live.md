# Round 7, job A1: live admin walk (admin.taskdrop.in, staging), rerun

First run (earlier today): blocked, the browser was not signed in to the admin (stopped at /login, nothing walked). This rerun is signed in as the owner (hitendureacts@gmail.com), read only. Date 16 Nov 2026, about 14:45 to 15:10 India time.

## Method and limits

- Claude in Chrome, my own tab (closed at the end). No source edited, no button that changes data pressed (no Pay, Approve, Refund, Suspend, Delete, Send, Save, Create, switch). Compose form: typed a throw-away title and message, pressed "Review and send", saw "Send this to 204 people?", pressed **Back** (nothing sent). Suspend and Delete-account dialogs opened and left without confirming (the Suspend one with Cancel, the Delete one by reloading the page).
- Side effects I cannot avoid: every person page I open writes an audit row "Opened a person page with phone and email showing" (2 rows: Tasker 7001, workerPro, plus Deepika Siddiqui); one People export was fetched (GET, not saved to disk) to check B107 and B125, so the audit log now has one more "crm export 185 people" line. I also created nothing else. A temporary key set in this tab's localStorage was removed.
- Window width: the tool's page stays at 767 px (resize_window does not change it), so the "768" pass is really 767 (one pixel under 768).
- 390 and 1440: the admin sends `X-Frame-Options: DENY` and `window.open` popups are blocked, so the real page cannot be framed. Workaround: copy the rendered DOM (scripts removed) into a same-origin `srcdoc` iframe of 390, 768 or 1440 px and measure it (CSS layout only, no JS behaviour). Noted once: the real page at 390 and 1440 is not reachable with these tools.
- At 767 and 390 the layout is the "mobile" layout (sidebar becomes a scrolling pill bar at the top, tables scroll inside their own box). At 768 and 1440 (iframe) the sidebar is also the pill bar at 768 and a left sidebar at 1440.

## What I walked

ok = loads, no console error, no failed network call, no page-wide horizontal scroll, no raw error text. bug = see finding. "n/a" = not reachable.

| Page | 390 | 767/768 | 1440 | Notes |
|---|---|---|---|---|
| Dashboard `/` | ok | ok | ok (screenshot) | 1.4 s; counts tie out (see below) |
| Needs you now | ok | ok | not measured | 31 rows = 7 withdrawals + 24 disputes, all shown |
| Earnings and escrow `/money` | ok | ok | not measured | escrow table sums to 33,784.00 over 50 rows, same as the card |
| Earnings entries `/money/entries` | ok | ok | not measured | 50 per page, paging works |
| Payouts | ok | ok | not measured | first load 3.1 s once (A1-9) |
| Refunds | ok | ok | n/a | empty state fine |
| Money check | bug (A1-3) | bug | n/a | rows carry no job or person |
| Jobs `/tasks` + a job (dispute job 7e9239c5) | ok | ok | ok | 757 to 758 jobs, filter counts tie out |
| People + person tabs (Overview, Money, Follow-ups, Devices, Audit) | ok | ok | n/a | workerPro (10 audit-style activity lines) and Tasker 7001 |
| Devices | ok | ok | n/a | 491 installs = 473 + 17 + 1 |
| Disputes | ok | ok | n/a | 24 rows |
| Reports queue | ok | ok | n/a | job link is just "A job" (A1-8) |
| Alerts | ok | ok | n/a | |
| Help requests | ok | ok | n/a | empty state |
| Copyright notices | ok | ok | n/a | empty states |
| Feedback board | ok | ok | n/a | empty (0 ideas) |
| Promotions | ok | ok | n/a | empty |
| Customer hub, Follow-ups and pipeline, Leads, Segments, Messages | ok | ok | n/a | count mismatch A1-1; /crm/tasks first load 4.2 s once (A1-9) |
| Business reports | ok | ok | n/a | |
| Team performance | ok | ok | n/a | table scrolls inside its box |
| Admin: Team and roles | ok | ok | n/a | |
| Admin: Money and timing (`/settings`) | **bug** (A1-2) | ok | n/a | raw JSON value overflows at 390 |
| Admin: App switches | ok | ok | n/a | B112 verified |
| Admin: Rules, Web/Android/iOS controls, Integrations | ok | ok | n/a | |
| Admin: System health | ok | ok | n/a | 2.0 s; Audit-log check alone 1.38 s |
| Admin: Audit log (3 views) | ok | ok | n/a | |
| My security `/security` | ok | ok | n/a | |
| Global search, 404, bad ids, out-of-range pages | n/a | bug (A1-4) | n/a | |

Console: no console errors on any page, except the three "Minified React error #441" lines from the out-of-range pages (A1-4). Network: no 4xx or 5xx on any page load (dashboard prefetch of 7 pages and the live feed all 200; Sentry POST 200). No phone number or email appeared in any list page text; they appear on the person page, the CSV, and as payout destinations (A1-7).

Tie-outs checked: dashboard Online 2, Getting quotes 322 (323 later after a new job), Hired and in progress 28, Overdue 11, Waiting for OK 0, Open disputes 24, Posted today 1/2: all equal the Jobs filter counts (322 + 28 + 24 + 193 finished + 190 cancelled = 757 at the time) and the Disputes list (24 rows). Withdrawals "7 need you, 4,900.00" equals the Payouts "Waiting for you 7, 4,900.00". Needs you 31 = 7 + 24. Whose-money card adds up: 3,582.25 + 33,784.00 + 1,43,095.00 + 10,035.00 + 4,900.00 + 0 = 1,95,396.25. Pipeline 45 + 34 + 4 + 18 + 84 = 185 = People Everyone. ₹ uses Indian grouping everywhere; dates read "14 Nov, 05:19 pm".

## Rechecks of recent fixes

| Bug | Result | Proof |
|---|---|---|
| B107 phone/email split, deleted excluded | **Verified** for the People list and the export; masking itself **not reachable** | People Everyone = 185 and Deleted filter = 19 (185 + 19 = 204 total). Export rows = 185 (deleted left out). CSV columns include separate Phone and Email; 175 rows have a 10-digit Phone, Email empty for them, 10 rows have a real email and no phone. People list shows no phone or email at all. Person page shows Phone "+91 98880 77001", Email "-" (as Admin, with an audit row). Phone is not masked for Admin in the CSV or person page; masking by role cannot be seen from the only account I have. Deleted accounts are still counted in CRM audiences (A1-1) |
| B108 person Audit tab shows every row | **Verified** | Deepika Siddiqui Audit tab shows 6 rows (4 "Opened a person page ... showing", "Suspended them", ...), Tasker 7001 shows my new row; global rows now say "About workerPro" (target named) |
| B112 Switches warning "0 of 6" | **Verified** | `/settings/switches`: banner "Do not turn on Authenticator code for money actions yet. No admin has an authenticator set up (0 of 6) ...", the switch reads "Off / Set up your authenticator first" and is disabled |
| B117 heartbeat lines hidden by default | **Verified** | `/settings/audit` default is "Everything" + "Without heartbeats" (0 system heartbeat lines in the first page); "Every line" shows 38 of 40 lines as "The system, Settings, Changed public_snapshots_last_ok"; "Staff only" shows 42 lines, 0 from the system, "Showing 1-40 of 42" |
| B122 paging past 1,000 rows | **Not reachable** | staging has 185 (204 with deleted) people and 758 jobs; nothing near 1,000. Paging itself works (Jobs 26 pages, last page 8 rows; People 7 pages, last 5 rows) |
| B125 export in batches | **Verified (small data only)** | 185-row CSV came back 200 in 1.99 s; a large run cannot be tested on this data |
| B132 first 200 of N | **Not reachable** | Support 0, Disputes 24, Alerts shows "100 alerts, Newest first, the latest 100" while the tab says Unread (188) (cap is told, but the numbers confuse, see A1-8). No list over 200 |
| B137 payout error text | **Verified (happy path)** | Payouts "Money position" shows real numbers and RazorpayX "Not connected / Not set up"; no false "apply migration 066" notice. The error path itself cannot be forced read-only |
| B123 rate limit on actions | **Not reachable** | needs a write; I only reached the review step of the broadcast form |
| B127 security events to Sentry | **Not reachable** | no UI for it (only the generic Sentry POST 200 seen) |
| B133 read-only for view roles | **Not reachable** | signed in as Admin; every button is live. Team page lists the Viewer "Neha (dummy viewer)" but I cannot sign in as it |

## Findings

Counts: High 0, Medium 3, Low 7 (plus 2 notes).

### A1-1 · CRM audiences and reports still count the 19 deleted accounts (204 vs 185)
- Page: Messages, Customer hub, Business reports, Segments. Width: all (data issue). Severity: Medium.
- Steps: open People (Everyone = 185, Deleted = 19). Open `/crm/messages`: "Send to: Everyone (204), All workers (108), People who only post (96)". Type any title and message and press "Review and send": "Send this to 204 people? Everyone will get ...". Customer hub shows "People 204"; Business reports shows "People in total 204".
- Expected: the same 185 (deleted accounts left out, as B107 did for the People list and the export). Posters-only should be 77 (185 - 108).
- Actual: 204 and 96 (= 77 + 19 deleted posters). A broadcast confirm would claim to reach 204 people, 19 of them deleted. Pipeline on Follow-ups shows 185.
- Proof: screenshot of the confirm step (taken, not saved to shots; text above is exact). Nothing sent.

### A1-2 · Settings page scrolls sideways at 390: a raw JSON value does not wrap
- Page: Admin and configuration, Money and timing (`/settings`), "Advanced" list. Width: 390. Severity: Low.
- Steps: open `/settings` at 390, scroll to the end of "Advanced (ads pricing and others)".
- Expected: the value wraps or is formatted.
- Actual: `public_cache` shows the raw text `{"app":false,"memo":true,"snapshots":true}` in a large bold `setting-value` box that does not wrap; the page becomes 461 px wide against 375 (horizontal scroll bar, value cut off). Same list also prints the raw UTC time `public_snapshots_last_ok 2026-11-16T09:20:06.273Z`.
- Proof: `shots\A1-settings-390-overflow.jpg`.

### A1-3 · Money check: 90 problem rows, none says which job, person or amount
- Page: Money check `/money/reconcile`. Width: all. Severity: Medium.
- Steps: open the page, read "What to look at" (90 rows: 69 "Finished with no commission booked", 15 "Payment never completed", 6 "Withdrawal waiting too long").
- Expected: each row names the job or withdrawal and links to it; the list covers every stuck withdrawal.
- Actual: (a) the 69 commission rows show only a date and the line "Finished job has no worker commission in the ledger" (no job title, no link, no amount), so the owner cannot act on them; (b) "Withdrawal waiting too long" lists 6, but 7 withdrawals have waited more than three days. The one missing is the 4 Oct, 300.00 withdrawal by workerPro that Payouts marks "Locked 43 days" (the claim lock). The list has 31 Oct 600, 17 Oct 500, 5 Oct 1,200 / 300 / 500 and 4 Oct 1,500, but not the second 4 Oct item; (c) the page says 90 open problems while System health says "Everything is working" and the nightly "Our books" check of 16 Nov says "0 checked, All fine" (B118 still open).
- Proof: page text of 16 Nov 14:50; Payouts list "Needs you 7" vs Money check "6".

### A1-4 · Going past the last page crashes Jobs and People with raw React error text
- Page: Jobs and People lists. Width: all. Severity: Low (needs a typed URL, or a list that shrinks while open).
- Steps: open `/tasks?page=26` (last real page is 25) or `/users?page=99`.
- Expected: an empty list or the last page.
- Actual: "This page couldn't load. Nothing was changed. The most common reasons: ... Minified React error #441; visit https://react.dev/errors/441 ... Try again" and 3 console errors. `/money/entries?page=999` instead quietly shows page 1 with "Older" (inconsistent). `page=abc` shows page 1.
- Proof: console lines `Error: Minified React error #441` (3 of them, from `/_next/static/immutable/chunks/0ymqegzwk65hi.js`).

### A1-5 · Small tap targets at 390
- Page: most pages. Width: 390. Severity: Low.
- Steps: measure links and buttons in the main area at 390.
- Expected: at least 24 px (ideally 44) high.
- Actual: dashboard 27, People 26, Payouts 23, Earnings and escrow 36 targets under 32 px, many text links only 15 to 20 px high: breadcrumb "Home" 36 x 15, "Refresh" 67 x 19, "See all 31" 74 x 18, "Today's entries" 116 x 19, "All earnings" 92 x 19, "See every payout" 130 x 19, top "Turn on alerts" 127 x 30.

### A1-6 · Page titles do not name the page; the unread count flickers in the tab title
- Page: all except Needs you now ("Needs you now"). Width: all. Severity: Low.
- Actual: the tab title is "TaskDrop Admin" or "(30) TaskDrop Admin" on almost every page (Payouts, Money, Jobs, People, Settings ...), and it alternates between the two forms on the same page within seconds. Browser history and tab lists cannot tell the pages apart.

### A1-7 · Payment details shown in full where they are not needed
- Page: Dashboard "Latest money movements"; Payouts. Width: all. Severity: Low (privacy, H33).
- Actual: the dashboard row for a cancelled withdrawal shows the full UPI id ("Ravi (seed worker) · UPI · ravi.e2e@okaxis"). Payouts shows full UPI ids including phone numbers (e.g. `8074413313@ybl`, `9849874454@ybl`) and a full bank account plus IFSC (`50100234567890`, `HDFC0001234`). Payouts needs them to pay by hand, so only the dashboard line looks like an extra. Fake data here, but the real data would be real.

### A1-8 · Small wording and labelling gaps (one finding, several lines)
- Severity: Low.
- Reports queue: a flagged job shows only "Job A job" and a link "A job" (no title).
- A bad payout id (`/payouts/00000000-...`) says "That job or person doesn't exist" (wrong noun).
- Audit log: nine "Dispute decisions: Added dispute decisions" rows and a "Changed suspensions" row have no target (B108 only partly done); "Opened a person page with phone and email showing" is then repeated as "... visible" on the next line.
- Alerts: tab "Unread (188)" but the heading under it says "100 alerts, the latest 100" (the cap is told, the two numbers look contradictory). Digest text "1 new people".
- Dashboard: "Online now 2 (2 of them can work)" next to "Workers available now 0" with no explanation.
- Tag "1+1" (a test tag, 0 people) has a live Delete button on the Customer hub (not pressed).

### A1-9 · A few first loads over 3 seconds
- Page: Payouts (3.1 s load), Follow-ups and pipeline `/crm/tasks` (4.2 s). Severity: Low.
- Re-measured right after: Payouts 2.0 s, /crm/tasks 1.4 s. Everything else 0.7 to 1.6 s; the admin shell's `/api/live` call takes 1.2 to 2 s in the background. System health: the Audit-log check takes 1.38 s (others 100 to 300 ms).

### A1-10 · Narrow widths could not be tested on the real page (mention once)
- The admin refuses framing (correct) and popups are blocked, so 390 and 1440 were measured on a copy of the page in a same-origin iframe (CSS only). No other action is needed unless the owner wants a real-device pass.

### Notes (not bugs)
- The break-it strings `${7*7}{{7*7}}<%= 7*7 %>` (a worker, a dispute counterpart, an audit target) are shown as literal text everywhere: escaping works.
- Seed oddities that look like bugs but are data: a cancelled job priced 9,99,99,999.00 ("Bookshelf assembled at home"), 20 identical "[e2e] dispute" rows in Disputes, Needs you and escrow.
- Dev sign-in switch is ON (`dev_otp_for_all`), the staging banner says so on the switches page.

## Left changed

Nothing in the data. Side effects only: 3 audit rows "Opened a person page ..." plus 1 "crm export 185 people" row, and the live feed marks a few pages as read. No settings, switches, notes, tags, messages, payouts or accounts touched.
