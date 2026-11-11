# Plan history: sections moved out of the ultimate plan

Moved on 11 November 2026 (the final pass) so the plan holds only what is still true. Nothing here is a task.

## Snapshot: where you were on 30 October 2026

Kept for the record. The live picture is the **Start here** panel at the top of the page.

**Already done**

- The app works on the website and on Android with fake money (checked "finished" on 2026-10-28).
- Staging safety is live: the "Staging" ribbon, the block on real payment keys, the site hidden from Google, the staging notice in Terms and Privacy.
- The app tour, the admin app with staff roles, Google sign-in, error alerts (Sentry), uptime monitors and GitHub secret scanning all work.
- Your 20-minute phone walkthrough (30 Oct): 11 fixes are merged into `redesigned-2.0` and published to the phone app (31 Oct, task 1.2).

**Not done yet**

- 4 phone problems from 28 Oct, about 8 small bugs, and 10 design changes you asked for. New on 31 Oct: content and alerts hidden behind the phone keyboard (task 1.8).
- Security: Claude's check on 30 Oct found real open holes (see the **Security** section). None can move money today, because staging has only fake money, but every one must be closed before real money.
- Google Play: 12 testers for 14 days have not started. (Google's ID check is done: verified 27 Oct, task S.1.)
- All the business paperwork for real money: company, bank, lawyer, payment approval, SMS registration.
- Production, the real-money copy of TaskDrop, does not exist yet.

**The three things that matter most right now**

1. **Start the slow track today** (S.1 and S.2). Google's ID check and the company paperwork take weeks, and launch cannot happen without them.
2. **Fix the bugs you can see** (Step 1), so testers judge a good app, not a broken one.
3. **Close the security holes** (Step 2) before anyone outside your circle uses the app.

**Your first week, in order**

| Day | Do this | Task |
|---|---|---|
| 1 | Start Google Play's ID check (done: Google verified your identity on 27 Oct) | S.1 |
| 1 | Book a meeting with a Chartered Accountant | S.2 |
| 1 | Answer the decisions (deferred to future scope on 1 Nov 2026) | 1.1 |
| 1 | Open the staging app on your phone twice and try the walkthrough fixes (done by Claude 31 Oct) | 1.2 |
| 2 | Set up and protect your secrets file | 2.1 |
| 2 | Turn on 2-step sign-in on your 8 most important accounts (deferred to future scope on 31 Oct 2026) | 2.1b |
| 2 | Ask Razorpay and Cashfree for quotes (one email) (sent 31 Oct, waiting for their call back) | S.4 |
| 3 | Name check and trademark search (1 hour) | S.5 |
| 3 to 7 | Approve the design drawings Claude sends; say "start key protection" | 1.5, 2.5 |

---

## From the CEO review of 9 November 2026: the to-do tables

Replaced by "Do these now" in The plan on one page (11 Nov).

**What decides launch day now**

| When | You | Claude |
|---|---|---|
| This week | Book the CA (S.2). Send the Plan B questions to both Razorpay and Cashfree (S.4). Shortlist two fixed-fee lawyers (S.3). File the trademark (S.5). Answer decision 38 (29 and 37 done). Look at the new map (1.12) | Fix what you find in 1.12, then freeze. Write the Plan B design if you say so |
| Weeks 1 to 3 | GST and the current account arrive (S.2), then the SMS registration (S.6) and the payment company's KYC (S.8). Recruit workers in the launch areas (4.6) | Build Plan B after the written yes. Get Gate 2a ticked so the Google Play closed test (3.1 to 3.3) can start: its 14 days are the longest fixed wait |
| Weeks 3 to 6 | The 14-day test runs. Your clicks in 2.2 to 2.4 | One security round on the final code (2.16, decision 30), then Gates 2b, 3 and 4 |
| Weeks 6 to 8 | Production accounts (Step 5), the ₹10 test (6.3), GO (6.5) | Connect production (5.9), prove the copies are separate (5.11), launch day |

This is an estimate, not a promise: launch in about 8 to 10 weeks is realistic if S.2 starts this week. Banks, Google and the payment company set their own pace.

**Your next seven days**

| Day | Do this | Task |
|---|---|---|
| 1 | Book a CA. Ask the S.2 questions, including the new GST one | S.2 |
| 1 | Say "design the Plan B money flow" (decisions 29 and 37 answered 9 Nov). Answer decision 38 (launch areas) | Decisions |
| 2 | Send Razorpay and Cashfree the same Plan B questions: may TaskDrop use Route (Razorpay) or Easy Split (Cashfree), is there a turnover minimum, can the money be held until the poster approves, and what are all the fees? Their written answers decide decision 3 | S.4 |
| 2 | Send `docs/LAWYER_BRIEF.md` to two fixed-fee lawyers, with the Plan B question first | S.3 |
| 3 | Trademark search, then file the word "taskdrop" in class 35 as an individual (₹4,500) | S.5 |
| 3 to 7 | Look at the new map (D21, built 9 Nov) on taskdrop.in on your laptop and say "done 1.12" or what to fix, so the freeze can start | 1.12 |
| 3 to 7 | Your clicks: spending alerts, lock the key stores, read the emergency guide once | 2.2, 2.3, 2.4 |
