/**
 * The server's contact rules must be the app's rules. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/contacts.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as app from "../../../apps/mobile/src/lib/mask.ts";
import * as server from "./contacts.ts";

const regexes = (list: RegExp[]) => list.map((r) => `${r.flags}/${r.source}`);

test("the patterns are identical in the app and on the server", () => {
  assert.deepEqual(regexes(server.PATTERNS), regexes(app.PATTERNS));
  assert.deepEqual(regexes(server.ADDRESS), regexes(app.ADDRESS));
});

const SAMPLES = [
  "Call me on 98765 43210",
  "mail ravi.k@example.com please",
  "see www.example.com/portfolio",
  "wa.me/919876543210",
  "my insta is ravi_fixes",
  "ping me on telegram",
  "@ravi_fixes will do it",
  "Flat 12B, Green Park, near the temple",
  "#45, 2nd main road",
  "PIN 560001 area",
  "I can do it for ₹250000 by Friday",
  "Fix a leaking tap, 2 hours, tools needed",
  "Order 3 boxes of 12 on 2nd floor",
  "nine eight seven six five four three two one zero",
  "९८७६५४३२१०",
  "9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣",
  "I need one or two people, three hours, four pm",
];

test("the same text gets the same answer from both", () => {
  for (const text of SAMPLES) {
    assert.equal(server.findContactIssue(text), app.findContactIssue(text), text);
    assert.deepEqual(server.maskContacts(text), app.maskContacts(text), text);
    assert.equal(server.nameCarriesContact(text), app.nameCarriesContact(text), text);
  }
});

test("a phone number, an email and a handle are caught; plain work is not", () => {
  assert.equal(server.findContactIssue("Call me on 98765 43210"), "phone");
  assert.equal(server.findContactIssue("mail ravi.k@example.com"), "email");
  assert.equal(server.findContactIssue("Fix a leaking tap, 2 hours"), null);
  assert.equal(server.maskContacts("98765 43210 here").masked, true);
  assert.equal(server.maskContacts("98765 43210 here").text, "••• here");
});

test("a phone number written in other digits, emoji or words is caught; counting in words is not", () => {
  for (const text of ["nine eight seven six five four three two one zero", "९८७६५४३२१०", "9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣", "call ٩٨٧٦٥٤٣٢١٠", "９８７６５４３２１０"]) {
    assert.equal(server.findContactIssue(text), "phone", text);
    assert.equal(server.maskContacts(text).masked, true, text);
  }
  for (const text of ["I need one or two people, three hours, four pm", "2️⃣ people for 3️⃣ hours", "one two three"]) {
    assert.equal(server.findContactIssue(text), null, text);
  }
  assert.equal(server.nameCarriesContact("९८७६५४३२१०"), true);
});
