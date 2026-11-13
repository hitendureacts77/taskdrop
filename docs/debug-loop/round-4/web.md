# Round 4: web explorer (taskdrop.in, staging, HEAD e579a29)

Date: 13 Nov 2026. Browser: Chrome (Claude in Chrome), viewport 852x710 (the screen caps the window; resize to 1440 was refused by the OS screen size, 1536x864 at 1.125 zoom). Fake test numbers only; no payment page touched.

## Bugs

### R4-W1 · Guest's chosen area on Hire Home is forgotten after a reload
- Class: UI · Level: Medium
- Steps: signed out, Continue as guest, Hire Home, tap "Set your location", confirm a pin (Madhapur). Header shows "Madhapur". Reload the page.
- Current: header is back to "Set your location"; `localStorage['taskdrop.guest.area.v1']` still holds an older value (Ward 104 Kondapur) that Home never reads. The same guest area IS used by `useMyArea` (maps), so Home and Explore disagree.
- Expected: Home reads and writes the same guest area (`GUEST_AREA_KEY`) as `useMyArea`.
- Proof: zoom of header after reload "Set your location"; JS `localStorage.getItem('taskdrop.guest.area.v1')` = Kondapur after choosing Madhapur. No console errors.
- File: `apps/mobile/src/components/HomeSections.tsx` `choosePlace` (line ~163: `if (!userId) return;` with no AsyncStorage write) and `loadTop` (guest branch never sets `place`). Also the post flow's "Where" step does not pre-fill the guest area ("Set where the job is").

### R4-W2 · Typing "+91 ..." in the phone box still produces a different, valid number (B72 recheck: still broken for typing)
- Class: UI · Level: High
- Steps: sign-in screen, click the mobile box, type a +91 and a fake 10-digit number key by key.
- Current: the box shows "91" followed by the first 8 digits of the number, with a green tick and "Text me a code" enabled: the code would go to a different 10-digit number, another person's. Pasting the whole string at once is fixed (the +91 is dropped correctly).
- Expected: typed country code is stripped as well (e.g. strip a leading 91/+91 while the digits grow past 10, or refuse an 11th digit and show "drop the +91").
- Proof: zoomed screenshot of the field starting "91" with a tick.
- File: `apps/mobile/src/lib/phone.ts` `normalizeMobileInput`: when typed one key at a time the value is already capped at 10 digits (starting "91"), so the 12-digit "91..." rule never fires.

### R4-W3 · Age gate can be passed by simply trying again with an older birth date
- Class: Both · Level: Low (owner decision)
- Steps: new number, birth date 14 Nov 2008 (17) → "TaskDrop is for adults only" → OK → same number again, birth date 1995 → code is sent, account can be made.
- Current: no memory of the failed check for that number or device.
- Expected (suggestion): remember the refusal on the device and for the number for some days, or at least for the session.

### R4-W4 · Post flow accepts a price of ₹9,99,99,99,999 with "Any amount works"
- Class: Both · Level: Medium
- Steps: Drop a task → Budget → type `-99999999999.555`.
- Current: minus sign and decimals are dropped (good) but the price becomes ₹9,99,99,99,999, hint "Any amount works", Continue enabled; Review shows fee ₹29,99,99,999.97 and held ₹10,29,99,99,998.97; Auto-hire says "First offer at or under ₹9,99,99,99,999". `createTaskSchema.benchmarkMinor` (`packages/schemas/src/index.ts`) has no upper bound.
- Expected: a sane maximum on both client and server (and a hint above it).

### R4-W5 · "At a place" task can be posted with no place set
- Class: UI · Level: Medium
- Steps: Drop a task → Place step: "At a place" selected, "Set where the job is" left empty → Continue → Review shows "Where: Location not set" and "Post my request" is enabled.
- Expected: an in-person task needs at least an area (or default to the saved area), otherwise it never shows on any distance search or map.

### R4-W6 · Composer counter shows 1687/1500 and Next stays enabled
- Class: UI · Level: Low
- Steps: set the composer text above 1500 characters (done by script, the browser maxlength blocks plain typing; a voice transcript or an idea chip could do the same).
- Current: "1687 / 1500" in normal colour, Next enabled, AI writes the post with the full text.
- Expected: counter turns red and Next is disabled over the limit, or the text is cut at 1500.

### R4-W7 · Wrong sign-in code gives no message
- Class: UI · Level: Medium
- Steps: new account, enter a wrong 6-digit code (e.g. 111111 or 121212).
- Current: the page freezes for a few seconds (the extension could not take a screenshot for ~10 s), then the code boxes are simply empty again; no "That code is wrong" text, no count of tries left.
- Expected: a plain error under the boxes and focus kept on the first box.

### R4-W8 · Sign-in hero copy says "Get help nearby. Or earn nearby."
- Class: UI · Level: Low
- Product rule: tasks are local AND remote; no copy may suggest local-only (AGENTS.md). The hero card does show "Logo design · Remote", but the headline is local-only.

## Rechecks of older bugs
- B35 (Home services worldwide): for a guest still shows a Berlin listing (`@grace_108`, Mitte, Berlin) under "Services near you" because the guest branch keeps "newest listings" (by design in the fix comment). Signed-in: see below.
- B72: paste fixed, typing still broken (R4-W2).
