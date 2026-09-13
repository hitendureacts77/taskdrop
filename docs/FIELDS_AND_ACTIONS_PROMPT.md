# Prompt: user-owned fields, real identity, working actions

Work through this without asking for confirmation. Use your own judgement where
this doesn't spell things out. Report what you verified, not what you assume.

## 1. Nothing is filled in on the user's behalf

Title, details, benchmark, "complete by" and location must all start empty and
be set by the user. Sample copy belongs in the placeholder, never in the value —
a prefilled field becomes real data the moment someone taps the primary button,
and the user ends up publishing an example they never wrote.

This applies everywhere a value is captured, not just the create form: the quote
amount, the offer stepper, the search filters, the profile fields. Audit every
`useState` that seeds a field with content rather than with empty/neutral.

Rules:
- Text fields: empty value, sample copy as placeholder.
- Amounts: no pre-filled rupee figure. If the screen needs an anchor, show the
  benchmark as context next to the field, not as the field's value.
- "Complete by": no default date. The user opens the calendar and picks one.
- Location: no assumed area. The user picks current location or a map result.
- Refuse to submit with a friendly message when a required field is empty,
  rather than silently substituting a default.

Keep the design's look. Placeholder text renders the same way the design's
filled-in mock does.

## 2. Services / Goods & products / Local help is an optional filter

These three are a filter, not a required choice. No selection means "show
everything", and tapping the active chip clears it. Verify this holds on every
screen that shows the row — feed, search, and anywhere else it appears — and
that nothing downstream assumes a pillar is always selected.

## 3. Make the share action real

The share control must actually share. Offer, in this order:
- the device's own share sheet, which is what surfaces WhatsApp, Instagram and
  whatever else the user actually has installed — do not hardcode a list of
  apps or assume any of them are present;
- copy link, as a reliable fallback that works everywhere;
- on web, use the Web Share API when the browser supports it and fall back to
  copy otherwise.

Pick the approach that works on Android and web from the one codebase, and make
sure the link it shares actually resolves to the thing being shared. Say so
plainly if a deep link target doesn't exist yet rather than sharing a dead URL.

## 4. Every button and control does something

Sweep the app for controls that look interactive and aren't: buttons with no
handler, rows that don't navigate, toggles that don't persist, icons that only
decorate. For each one, either wire it to the real behaviour or make it
unmistakably non-interactive. A control that silently does nothing is worse than
one that isn't there.

Where the backing data genuinely doesn't exist yet, the control should say so
when tapped instead of failing silently.

## 5. The worker's view of a poster shows real identity

On the task detail screen a worker sees:

    Requests posted     — · ★ —
    Distance            nearby

Both are placeholders. Fix them:
- "Requests posted" and the star rating must come from the poster's real
  profile — the count of requests they've posted and their poster rating.
- A brand-new poster has no rating; say that plainly instead of showing a dash
  or a fake 0.0.
- "Distance" must be computed from the two locations when both are known. When
  it isn't known, say something true rather than "nearby".

## 6. Verify

Typecheck and lint clean, `npm run check` green. Then drive it in the browser:
post a task with every field typed by hand, quote on it from the other account,
and confirm the poster's real rating and request count appear on the worker's
side. Check the console at each step. Re-run the full money loop to confirm
nothing regressed, and verify the split in Postgres directly.

Commit in logical chunks.
