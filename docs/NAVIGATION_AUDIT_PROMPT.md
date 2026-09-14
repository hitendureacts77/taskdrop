# Navigation and control audit

Check every route a user can reach and every control they can press, and make
each one do what it says. Work through it mechanically — the point of this
document is that nothing gets checked by eye and declared fine.

## The rule

A control is **working** only if all four are true:

1. **It responds.** Pressing it changes something the user can see.
2. **It reaches the server** when it claims to have changed stored state.
   A handler that celebrates and navigates without a write is broken, however
   convincing it looks.
3. **It refuses honestly** when it cannot do the job — no success toast for
   work that was skipped, no default values standing in for data it does not
   have.
4. **It survives failure.** A rejected request leaves the user somewhere they
   can recover from, with the reason shown.

Two failure shapes recur in this codebase and are the ones to hunt:

- **`if (id) await server(...)` followed by an unconditional `celebrate(...)`.**
  Without the id the server call is skipped and the user is congratulated
  anyway. Every instance is a bug.
- **A design fallback that looks like real data.** A default price, a sample
  person, a seeded conversation. On screen these are indistinguishable from
  the real thing, and on a money screen they are dangerous.

## How to check each one

For each route below: reach it the way a user would, press every control, and
confirm the effect in the database — not just in the UI. `npm run check` must
stay green, and the browser console must stay free of new errors.

Record each control as **works**, **fixed**, or **cannot reach** with a reason.
Do not record "looks right".

## Routes

Grouped as the user meets them.

**Getting in** — splash, welcome, signup (OTP entry, resend, verify), setup
(name, skills, location, finish).

**Finding work** — home feed (mode toggle, search field, the three pillar
chips, feed card open/counter/accept, urgent strip, create FAB, the five tab
bar destinations), search (query, filters, result open).

**Deciding** — task detail (back, share, quote stepper, send quote, poster
row), detail sheet (stepper, completion chips, send), compare (sort, pick,
lock).

**Doing the work** — orders (row open per state, cancel), swipe to start,
active (chat, photo proof, mark done), chat (send, back).

**Money** — escrow/pay (pay, check payment, reopen page), confirm (release,
ask for changes, dispute), wallet (withdraw, add funds, recent list),
withdraw (amount, quick chips, UPI add/change, withdraw, cancel a queued
payout), review (stars, praise chips, submit).

**Owning it** — profile (mode switch, theme, every menu row, sign out),
analytics (window chips), pro/verification, promote (budget, duration,
audience, start, activate).

## What to do with a broken one

Fix it, or make it honest. Both are acceptable outcomes; leaving it to look
like it works is not. Prefer fixing. If a feature genuinely is not built, the
control should say so plainly rather than pretending.

## Finishing

Report the count checked, the list fixed, and anything deliberately left as
not-yet-available. State plainly what was verified against the database and
what was only seen on screen.
