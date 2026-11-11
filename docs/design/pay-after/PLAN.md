# Funded and Not funded tasks (D25, task 1.15)

**Status: plan only, nothing built.** You asked for this on 11 November 2026 and said the same day: "Don't build
the feature, just build the plan." The build starts when you say **"start 1.15"**.

**What you asked for, in your words:**

1. "The poster need not pay money and can pay after the work is done." Mark every task card **Funded** or
   **Not funded**.
2. The map filters get a filter for Funded and Not funded tasks.
3. For a Not funded task, after the work is done and the poster approves it, the poster pays in TaskDrop. The money
   goes to the helper, with TaskDrop's commission taken.
4. When a poster picks pay later, a pop-up warns them that helpers may not want the task: "Workers may not accept
   this task as it is on pay-later. They won't show you much interest."
5. The point is to **push posters to pay while posting**: paid up front into escrow, the money is safe at TaskDrop
   and does not go to the helper until the work is done. A Funded task gives helpers assurance, so helpers choose
   Funded tasks first.

Point 5 changes today's Funded flow a little: today the money is taken **when the poster hires**, not when they
post. This plan moves it to **when they post**, so "Funded" on a card is true from the first second.

Plain words used everywhere in the app:

| Word on screen | Meaning |
|---|---|
| **Funded** | The poster paid when posting. TaskDrop holds the money safely and pays the helper only when the work is approved. Recommended, and the default |
| **Not funded** | The poster pays after the work is done, when they approve it. The helper takes the risk of a late payment, so TaskDrop shows it clearly and chases the poster |
| **Payment due** | A Not funded job whose work was accepted (by the poster, or automatically after 3 days) but which is not paid yet |

---

## 1. The whole flow, start to finish

```
POSTER posts ─► "When do you pay?"
                 ├─ Pay now (recommended, chosen by default)          → FUNDED
                 │     budget + 3% fee taken from the wallet NOW (top up by card if short)
                 │     TaskDrop holds it. It goes to the helper only when the work is approved.
                 │
                 └─ Pay after it's done → POP-UP WARNING (see 4.1) → "Pay later anyway"  → NOT FUNDED
                                                                     or "Pay now instead" → FUNDED

HELPERS see "Funded" (green) or "Not funded" (amber) on every card, can filter on the map,
and Funded tasks are shown first wherever lists are ranked.

FUNDED: poster hires an offer
   ├─ offer cheaper than the budget → the difference goes back to the wallet at once
   ├─ offer dearer                   → the difference is taken (top up if short), as today
   └─ helper starts straight away (the money is already held)
NOT FUNDED: poster hires an offer → nothing is charged → helper told "Not funded" → may start

Helper does the work ─► sends it (Work done)

POSTER reviews (3 days, as today)
   ├─ Funded:     "Approve and pay"   → the held money is released (today's flow, unchanged)
   ├─ Not funded: "Approve and pay ₹X" → charged from the wallet now (top up the gap if short)
   ├─ "Ask for changes" / "Report a problem" → same as today
   └─ says nothing for 3 days
         ├─ Funded                          → released automatically (today)
         ├─ Not funded, wallet holds enough → paid automatically from the wallet
         └─ Not funded, wallet short        → PAYMENT DUE
                ├─ poster cannot post or hire until it is paid
                ├─ reminders: at once, after 1 day, after 3 days
                ├─ after 7 days: on the admin's "Unpaid jobs" list
                └─ poster taps "Pay ₹X now" → completed, helper paid
```

From the moment a Not funded poster pays, the job is exactly a Funded job: the same commission, the same clearing
period, the same ledger rows, the same withdrawal path.

---

## 2. Money: who pays what, and when

The amounts do not change. Only the moment changes.

| | Funded (new: pay when posting) | Not funded (new) | Today, for comparison |
|---|---|---|---|
| Poster pays | budget + 3% fee | the chosen offer + 3% fee | the chosen offer + 3% fee |
| When | **when they post** | when they approve (or when the 3 days run out, if the wallet holds enough) | when they hire |
| Offer cheaper than the budget | the difference goes back to the wallet when they hire | nothing to give back | nothing to give back |
| No one is hired and the poster closes it, or it expires | everything back to the wallet | nothing was paid | nothing was paid |
| Helper gets | offer minus commission | offer minus commission | offer minus commission |
| TaskDrop keeps | commission + 3% fee | commission + 3% fee | commission + 3% fee |
| Poster cancels after the helper started | 5% fine, taken from the money held | 5% fine, **paid from the wallet when cancelling** | 5% fine from the money held |

Example, a ₹1,000 job (commission from the `worker_commission_pct` setting, fee 3%): a Funded poster pays ₹1,030
when posting; if they hire a ₹900 offer, ₹103 goes straight back to the wallet. A Not funded poster pays ₹927 when
they approve the ₹900 offer. Either way the helper gets ₹900 minus commission and TaskDrop books the commission
and the fee.

**Same commission for both** (decision 45). A higher cut on Not funded jobs would push posters further to Funded,
but it would feel like a fine. The pop-up and the ranking (section 3) already do the pushing.

---

## 3. Pushing posters to pay now (your point 5)

The goal: most tasks are Funded, because helpers trust them and answer them faster.

1. **Pay now is the default and says why.** The choice reads: "Pay now (recommended). Your money is safe with
   TaskDrop. It goes to the helper only when you approve the work, and comes back to you if no one is hired."
2. **The pop-up when choosing pay later** (section 4.1). It says plainly that helpers may not take the task.
3. **Funded tasks are shown first.** Wherever a list is ranked (the map's list, Jobs near you, Home's rails, the
   alerts sent to nearby helpers), a Funded task ranks above a Not funded one with the same pay. Sorting by pay or
   distance still works; Funded only breaks ties and gets a small lift (decision 47).
4. **Only Funded tasks use the fast extras:** Flash Drop and Auto-hire need the money held, so they are Funded
   only. A Not funded task can still get offers the normal way.
5. **The numbers prove it.** PostHog counts offers per task and time to first offer for Funded and Not funded
   (task 4.x analytics). If Not funded tasks get far fewer offers, the pop-up text can quote the real number:
   "Funded tasks get offers 3 times faster."

---

## 4. Screens: everything that changes

### 4.1 Posting (AI post screen, the "Who and how" step)

A new choice under **How do you want to hire?**:

> **WHEN DO YOU PAY?**
> ◉ **Pay now** · recommended · Funded
> Your money is safe with TaskDrop. It goes to the helper only when you approve the work, and comes back to you
> if no one is hired. Helpers see "Funded" and offer faster.
>
> ○ **Pay after it's done** · Not funded
> You pay when you approve the work.

**Tapping "Pay after it's done" opens a pop-up first** (the choice only changes if they confirm):

> **Helpers may not take this task**
>
> Workers may not accept this task because it is pay later. They will show you less interest, and your task is
> shown after funded tasks.
>
> If you pay now, the money is kept safe at TaskDrop in escrow. It does **not** go to the helper until the work is
> done and you approve it, and it comes back to you if no one is hired.
>
> If you choose pay later: when you don't answer within 3 days of the work being sent, we pay from your wallet. You
> can't post or hire while a payment is due.
>
> [ **Pay now instead** ] (the main button)  [ Pay later anyway ]

- "Pay now instead" is the big button and keeps Funded. "Pay later anyway" is the plain one.
- The pop-up shows every time pay later is chosen, not only the first time.
- The choice is hidden when the admin switch is off, for a City Hunt, Flash Drop or Auto-hire, and for a service
  listing. Above the pay-later limit (₹5,000) it shows greyed with "Up to ₹5,000".
- **Paying when posting (Funded):** "Post my request" becomes **"Pay ₹1,030 and post"**. A short wallet opens the
  top-up for exactly the gap first (the same sheet Auto-hire uses today), then posts by itself once the money lands.
- The review step's money box: Funded "Paid now, held safely by TaskDrop until you approve: ₹1,030. If you hire a
  cheaper offer, the difference comes back." Not funded: "You pay when you approve the work. Nothing is paid now."

### 4.2 Cards and pins (everywhere a task is shown)

A small badge next to the price, the same size as the "topped up" badge:

| Task | Badge |
|---|---|
| Funded | green shield **Funded** |
| Not funded | amber clock **Not funded** |

Shown on: the Explore map's list and selected card, Jobs near you (Home), the work cards in lists, the task page
header, the guest view. The map pins themselves stay as they are (too small); the filter does the work there.

### 4.3 Map filters (Explore)

The Filters sheet gets a **Payment** row: **All · Funded only · Not funded**, saved on the device with the rest.
When it is not "All", a chip ("Funded only") shows beside the other chips and counts in the Filters badge.

### 4.4 Task page (helper's view)

Under the price, one line in the badge's colour:
- Funded: "Funded · the money is already held by TaskDrop. You are paid when the work is approved."
- Not funded: "Not funded · paid when the poster approves the work. Paid 4 of 4 jobs after the work." (or
  "1 late payment", or "New to paying after the work")

### 4.5 Offer sheet (helper)

For a Not funded task, an amber note above Send: "This job is not funded. You are paid when the poster approves
your work, not before you start."

### 4.6 Poster's task page and the approve screens

- Funded after the hire: "Hired · your money is held safely until you approve." (The "Pay ₹X now" step after hiring
  goes away for new tasks, because the money is already in.)
- Not funded after the hire: "Hired · you pay when you approve the work."
- On Work done, Not funded: the main button reads **Approve and pay ₹X**. A short wallet opens the top-up for exactly
  the gap, then pays by itself once the money lands.
- Payment due: a red bar on the task page and on Home: "You owe ₹X for <task>. Pay now to keep posting."

### 4.7 Helper's job page

- Funded: "Funded · the money is held. You can start."
- Not funded, before start: "Not funded · you can start now. You are paid when the poster approves."
- Payment due: "The work was accepted. The poster has not paid yet; we have reminded them. You will be told the
  moment it is paid."

### 4.8 Notifications (plain words; money lines stay hidden on the lock screen, decision 26)

| When | To | Words |
|---|---|---|
| Posted Funded | poster | "₹1,030 is held safely for <task>. It goes to the helper only when you approve." |
| Hired, Funded, cheaper offer | poster | "₹103 is back in your wallet: you hired an offer below your budget." |
| Hired, Not funded | helper | "<Poster> picked you. This job is not funded: you are paid when they approve the work. You can start now." |
| Work done, Not funded | poster | "<Helper> sent in the work. Approve it and pay, or ask for changes." |
| Paid, Not funded | helper | "<Poster> paid for <task>. Your earnings will show in your wallet soon." |
| Payment due | poster | "Payment due for <task>. Pay ₹X now. You can't post or hire until it is paid." |
| Payment due | helper | "<Task> was accepted. The poster has not paid yet; we have reminded them." |
| Reminder after 1 and 3 days | poster | "Reminder: ₹X is due for <task>." |
| 7 days unpaid | staff | the job appears on Unpaid jobs |
| Funded task expired, no one hired | poster | "No one was hired for <task>. ₹1,030 is back in your wallet." |

### 4.9 Admin (the administrator app)

- Settings: the new keys with plain labels (section 5).
- Tasks list and task page: the Funded / Not funded label.
- A new **Unpaid jobs** list: every Payment due job, oldest first, with days overdue, poster, helper, amount.
- The money position page: "Held for open Funded tasks (no one hired yet)" as its own line.

---

## 5. What protects the helper on a Not funded job

A Not funded job means a helper can work and not be paid. Nothing removes that risk; these rules make it rare,
visible and costly for the poster.

1. **They always know:** the label, the task page line, the offer sheet note, and the Funded only filter.
2. **Limits on posters** (admin settings, decision 43):
   - `pay_after_enabled`: the main switch. Off hides the choice and refuses new Not funded tasks.
   - `pay_after_max_minor`: the highest price of a Not funded task. Default **₹5,000**, the same as the new-account
     limit (decision 12).
   - `pay_after_max_open`: how many Not funded tasks one poster may have open or unpaid at once. Default **3**.
3. **One unpaid job blocks the poster:** no posting, no hiring, no deleting the account, until it is paid.
4. **Paid automatically when possible:** after 3 days of silence the job is paid from the wallet if it holds enough.
   The pop-up said so.
5. **Reminders, then staff:** at once, after 1 day, after 3 days; after 7 days on the Unpaid jobs list, where staff
   can call, warn or suspend.
6. **A record helpers can see:** each poster's "paid N of N after the work" and late payments, on the task page.
7. **Cancelling late is not free:** a poster who cancels after the helper started pays the 5% fine from the wallet in
   the same step.

**What TaskDrop does not promise:** it does not pay the helper from its own money when a poster never pays. That
would make TaskDrop a lender. It goes to Future scope as "Pay-later guarantee".

---

## 6. The database and server (for Claude, when you say "start 1.15")

A draft was written and checked on 11 November before you stopped the build; it was taken out of the code folder and
is not applied anywhere. The build follows this list.

**Migration A: `task_status` gets `PAYMENT_DUE`** (an enum value must be committed before it is used, so it is its
own file).

**Migration B: the flow.**

- `tasks.pay_mode` (`upfront` | `after`, default `upfront`, set once when posting, public), `tasks.pay_due_at` and
  `tasks.pay_reminded` (parties only). `profiles.paid_after_count`, `profiles.paid_late_count` (public, server-set).
  Each goes in `api/columns.ts`, `docs/SECURITY_COLUMNS.md` and `tests/column_decisions.test.sql`.
- Settings: `pay_after_enabled` (true), `pay_after_max_minor` (500000), `pay_after_max_open` (3),
  `funded_rank_boost` (decision 47).
- **Paying when posting (Funded):** a new step after the task row is made charges budget + fee from the wallet
  through the existing wallet charge (`fund_task_from_wallet`, migration 148, taught to fund an OPEN task from its
  budget), and the api refuses to post when the wallet is short (as Auto-hire does today), so the app asks for the
  top-up first. A crew charges each slot.
- `lock_bid` and Auto-hire: Funded and the offer is cheaper → the difference back to the wallet in the same step;
  dearer → the existing "charge the difference". Not funded → nothing charged. Anyone with a payment due cannot hire.
- Helper backs out of a Funded task: the money **stays held** and the task goes back to OPEN still Funded (today it
  goes back to the wallet). The refund trigger learns this.
- An expiry sweep: an OPEN Funded task whose deadline passed with no one hired gives everything back (runs with the
  other money sweeps every 15 minutes).
- `start_task`: a Not funded job starts without money; Funded keeps every check.
- `pay_after_settle`: charge the wallet, then release exactly as `confirm_release` does, and count the poster's
  record. A short wallet raises "Not enough money in your wallet" with the gap, which the app already turns into a
  top-up. Used by `confirm_release` (Not funded), the new `pay_task_due`, the 3-day sweep and staff decisions.
- `auto_complete_due`: Not funded after 3 days → pay from the wallet, else PAYMENT_DUE; then the reminder sweep.
- `cancel_task`: a started Not funded job → the 5% fine from the wallet to the helper; a PAYMENT_DUE job cannot be
  cancelled by either side.
- `admin_resolve_dispute` "for the helper" on an unpaid Not funded job → charge the wallet, else PAYMENT_DUE.
- New: `public.pay_task_due(task)`, `public.admin_unpaid_jobs()`; both in `tests/rpc_surface.test.sql`.
- `account_deletion_blockers`, `on_task_changed` (the notifications), `task_contact_phone`, the guest card reader:
  know PAYMENT_DUE and `pay_mode`.
- Every rewritten function keeps every refusal it had (`scripts/check-lost-refusals.mjs`).
- The api: `createTask` takes `payMode`; new write `payTaskDue`; PAYMENT_DUE counts as in progress and as "needs
  your attention"; ranked reads add the Funded lift.
- The app: the choice, the pop-up and "Pay ₹X and post"; the badge and the task page line; the map filter; the
  offer sheet note; Approve and pay; the Payment due bar. Each new screen piece is checked on web and Android.

**Under Plan B (decision 29)** nothing changes for the people using it. "Charge the wallet" becomes "open the
payment company's checkout", and the money is held by the payment company, not TaskDrop. Two questions this adds to
S.4 (ask both companies in writing): (1) **may the money be held from posting until approval**, which can be days
before anyone is hired, and refunded in full if no one is hired? (2) for a Not funded job, can the split to the
helper happen on a payment taken at approval? Both are normal for marketplaces but must be in the contract.

---

## 7. Edge cases, decided

| Case | What happens |
|---|---|
| Funded, the poster hires a cheaper offer | The difference goes back to the wallet at once |
| Funded, the poster hires a dearer offer | The difference is charged; a short wallet tops up first (as today) |
| Funded, no one hired, the poster closes it or it expires | Everything back to the wallet |
| Funded, the helper backs out | Back to OPEN, still Funded; the money stays held for the next helper |
| Not funded, the helper backs out | Back to OPEN; nothing to give back |
| Either kind, the poster cancels before the helper starts | Free; a Funded poster gets everything back |
| Not funded, the poster cancels after start | 5% fine from the wallet to the helper, or "add money first" |
| Not funded, the poster reports a problem on the sent work | Same as today. Staff decide: for the helper → the poster is charged (wallet, else Payment due); for the poster → closed, nothing owed |
| Not funded, work done, poster silent, wallet short | Payment due after 3 days |
| A poster with a payment due tries to post or hire | Refused with "Pay what is due first" and the Pay button |
| A poster with a payment due tries to delete the account | Refused, as for an open job |
| Crew task | Each slot is its own job, Funded or Not funded together; the pay-later limit counts each |
| Repeat task | The copy keeps the pay mode; a Funded copy is paid when it is made, or waits as a draft if the wallet is short |
| City Hunt, Flash Drop, Auto-hire, service listings | Funded only |
| The admin turns pay later off | Existing Not funded jobs carry on; only new ones are refused |
| Card payment charged back after the helper withdrew | Same as today (the 7-day clearing is the protection) |
| Tasks posted before this change | Stay as they are: Funded, paid when hiring, as today |

---

## 8. Decisions for you (the recommended answers are what the build will use; say to change)

| # | Question | Recommended |
|---|---|---|
| 42 | Add Not funded tasks (pay after the work)? | **Yes, asked by you on 11 Nov** |
| 43 | Pay-later limits | ₹5,000 a task, 3 open at once, every signed-in poster; one unpaid job blocks posting and hiring |
| 44 | When the 3 days run out on a Not funded job and the wallet holds enough, pay automatically? | Yes (the pop-up says so) |
| 45 | The same commission for both kinds? | Yes |
| 46 | Funded means **paid when posting** (not when hiring), with the difference back on a cheaper offer and a full refund if no one is hired? | **Yes, asked by you on 11 Nov** ("make payment while posting the task itself") |
| 47 | Show Funded tasks first in lists and helper alerts (ties and a small lift; sorting by pay or distance still works)? | Yes |
| 48 | When to build it. It changes the money flow, so it is not a fix inside the freeze (decision 41, 22 Nov) | **Build it together with the Plan B money flow**, which already carries on past the freeze: both change the same money steps, so it is built and security-tested once instead of twice |

---

## 9. How it will be checked

- Unit: the map's payment filter; the label; the api's `payMode`; the refusal checker.
- Database (staging): post Funded with a short wallet (top-up asked) and with money (held at once) → hire a cheaper
  offer (difference back) → approve (helper in clearing, ledger rows). Post Not funded (pop-up shown) → hire → start
  without money → approve with a short wallet (top-up asked) → a second job left 3 days with a short wallet →
  Payment due → posting refused → pay → posting allowed. A Funded task left to expire → refunded.
- Browser (local web build on 127.0.0.1): the choice and the pop-up, "Pay ₹X and post", the badges, the Funded only
  filter, Approve and pay.
- Android: after the app update, the same walk on the phone (your check).
