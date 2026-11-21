# Round 8 brief: find every bug, write it down, fix nothing

Owner's order (16 Nov 2026, night): "check each and every functionality, every corner, except payments (Razorpay is not integrated). Find every bug and write it in the debugging plan. I want every bug noted." Fixing happens later, all together, in one pass. **Your job is to find and record. Do not fix.**

## What you must not do

- Do not edit any file except your own report file `docs/debug-loop/round-8/<YOUR-ID>.md`. No code edits, no commits, no branches, no pull requests, no `git checkout`/`git switch`/`git stash` in the shared folder `C:\complete taskdrop\Taskdrop user` (other helpers read it at the same time).
- Payments are out of scope: Razorpay, RazorpayX, Add money, Withdraw, payouts, refunds as money movement. You may read the wording and layout of those screens, but never press Pay / Add money / Withdraw / Confirm payout.
- No migrations, no function deploys, no wipes or reseeds, no key changes, no OTA or EAS builds. Read-only SQL on staging is fine (`select` only; roll back anything else).
- Never print, copy or write a secret, token, password, full phone number of a real person or email. The fake test accounts below are fine.
- Do not message real people. Everything on taskdrop.in is staging with fake data, but still post nothing offensive.
- If something blocks you (cannot sign in after two tries, a tool is missing), stop and report that in your final message instead of guessing.

## What counts as a bug

Anything wrong: crash, blank screen, wrong text or number, wrong state after an action, button that does nothing or does the wrong thing, missing validation, a rule the server does not enforce, a rule the client enforces but the server does not, data leak, wrong colour or contrast, cut-off or overlapping text, tap target under 40 px, keyboard covering a box, slow or janky feel, dead link, wrong back behaviour, missing empty / loading / error state, dark mode or width breakage, copy that contradicts the product rules in `AGENTS.md`, accessibility (labels, focus, contrast), spelling. Also record **info** items (not bugs, but worth the owner's eye).

Be honest: every entry needs evidence (file and line, a query result, a measured size, text you read from the page, or a screenshot path). Do not invent bugs to reach a number; do not stop early either. Dig into every screen, state, error path, empty state and edge input in your area. A thorough area gives dozens of findings.

## Before you write a finding: is it already known?

Search `docs/debug-loop/LEDGER.md`, `docs/debug-loop/ROUND-7.md` and `docs/debug-loop/round-7/*.md` for the same symptom (grep a distinctive word). If it is known, still list it in one line under "Known, seen again" with its id and whether it is still reproducible; do not write a new entry. Only new things get a new id.

## Level

- **Critical**: money lost or exposed, another person's data readable or writable, account takeover, app unusable for everyone.
- **High**: a main flow blocked or wrong for many people, a rule the server does not enforce.
- **Medium**: wrong behaviour in a normal flow, with a workaround.
- **Low**: cosmetic, wording, small edge case.
- **Info**: not a bug.

## Report format (append as you go, so nothing is lost if you stop)

File: `docs/debug-loop/round-8/<YOUR-ID>.md`. Start with one paragraph: what you covered, how (code read / live), width and theme, account, date. Then findings, ids numbered from `<YOUR-ID>-1`:

```
### <ID>-<n> · <one-line title>
- Level: <Critical|High|Medium|Low|Info> · Area: <screen or function> · Class: UI | Backend | Both · Where: website | Android | admin | all
- Steps: <how to reproduce, or the code path>
- Current: <what happens>
- Expected: <what should happen>
- Proof: <file:line, query, measured value, text read, screenshot path>
- Cause (if known): <one or two lines, no fix needed>
```

End with: `## Known, seen again`, `## Not covered (and why)`, and a line `Status: done` or `Status: stopped because <reason>`.

## How to search the code

The repo has a code graph. Run `graphify query "<question>"` before your first grep or read for a codebase question, then read only the lines it points to. Root: `C:\complete taskdrop\Taskdrop user`. App code: `apps/mobile/src` (`screens/`, `components/`, `lib/`, `providers/`, `navigation/`). Server: `supabase/functions/` (the `api` function is the main one) and `supabase/migrations/`. Shared rules and schemas: `packages/rules`, `packages/schemas`. Product rules: `AGENTS.md` (money: poster pays offer + 3 percent, worker pays 10 percent commission, 5 percent fine on cancel after start, 3 days to approve, earnings clear after 7 days; privacy: area only until a worker is chosen; 18+; two palettes: Hire jade, Earn royal blue). The admin is a separate repo at `C:\complete taskdrop\Taskdrop administrator` (Next.js).

## Live walks: accounts and rules

Only the live-walk jobs sign in. Website: https://taskdrop.in (staging, fake data and money). Test accounts, phone sign-in: **Asha 9990000001** (hiring), **Ravi 9990000002** (working), **Meera 9990000003**. On staging the sign-in code shows in a yellow "Test mode" box; use it. Admin: https://admin.taskdrop.in signs in only with the owner's Google account that is already signed in in Claude in Chrome; never type a password.

- Always test **signed in**. If you cannot sign in after two tries, stop and say so.
- Use only the account and browser given in your assignment; another helper uses the other accounts at the same time. The Chrome profile and the built-in pane keep one saved sign-in per site; do not sign out an account you were not given.
- Type key by key (not paste) in boxes, check at 390 px wide (phone) and 1440 px (desktop), light and dark, and look at the console and failed network calls on every screen.
- Tasks you create on staging: cancel them before you finish, so nothing is left open on everyone's Home.
- Phone (Android, adb): `C:\Users\naras\AppData\Local\Android\Sdk\platform-tools\adb.exe` with `MSYS_NO_PATHCONV=1`, serial 56b2717c, screen 1080x2376. **Before every tap or swipe, check the foreground app** (`adb -s 56b2717c shell dumpsys window | grep mCurrentFocus` must show `com.taskdrop.app`); an earlier tap landed in WhatsApp. Never touch another app.

## Your final message

At most 150 words: counts by level, the file written, anything that blocked you. Do not paste the findings into the message; they live in your file.
