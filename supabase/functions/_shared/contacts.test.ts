/**
 * One contact rule for the app, the api and the database. Run from the repo root:
 *   node --experimental-strip-types --test supabase/functions/_shared/contacts.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as app from "../../../apps/mobile/src/lib/mask.ts";
import { CONTACT_CASES, NAME_CASES } from "./contactCases.ts";
import * as server from "./contacts.ts";

const root = new URL("../../../", import.meta.url);
const MARKER = "// ==== ONE CONTACT RULE";
const ruleOf = (path: string) => {
  const text = readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
  const at = text.indexOf(MARKER);
  assert.ok(at >= 0, `${path} has the shared-rule marker`);
  return text.slice(at);
};

test("the rule is the same, character for character, in the app and on the server", () => {
  assert.equal(ruleOf("supabase/functions/_shared/contacts.ts"), ruleOf("apps/mobile/src/lib/mask.ts"));
});

for (const [name, rule] of [["app", app], ["server", server]] as const) {
  test(`${name}: every text in the table is refused as its kind, or let through`, () => {
    for (const { text, kind } of CONTACT_CASES) {
      assert.equal(rule.findContactIssue(text), kind, JSON.stringify(text));
      // Quotes, proof and chat hide every contact detail but an address (an area-level place is fine there).
      const masked = rule.maskContacts(text);
      assert.equal(masked.masked, kind !== null && kind !== "address", `mask ${JSON.stringify(text)}`);
      if (!masked.masked) assert.equal(masked.text, text);
    }
  });

  test(`${name}: names and usernames`, () => {
    for (const { text, carries } of NAME_CASES) assert.equal(rule.nameCarriesContact(text), carries, JSON.stringify(text));
  });
}

test("hidden parts are replaced, the rest of the text stays", () => {
  assert.equal(server.maskContacts("98765 43210 here").text, "••• here");
  assert.equal(server.maskContacts("call 98765/43210 or ravi@okaxis, thanks").text, "call ••• or •••, thanks");
  const snap = server.maskContacts("add me on snapchat: ravi_fixes ok");
  assert.equal(snap.masked, true);
  assert.ok(!snap.text.includes("ravi_fixes"));
  assert.equal(server.maskContacts("Budget 75000-80000, call 98765 43210").text, "Budget 75000-80000, call •••");
  assert.equal(server.maskContacts("my whatsapp number is 98765 43210").text, "my whatsapp number is •••");
});

// The database's copy of the rule is tested with the same rows (npm run test:db). The rows between the
// markers in contact_rule.test.sql must be exactly these; when this fails, paste the printed block there.
const sqlString = (s: string) =>
  "E'" +
  [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === "'") return "''";
      if (ch === "\\") return "\\\\";
      if (cp >= 0x20 && cp < 0x7f) return ch;
      return cp > 0xffff ? `\\U${cp.toString(16).padStart(8, "0")}` : `\\u${cp.toString(16).padStart(4, "0")}`;
    })
    .join("") +
  "'";

export function sqlCaseRows(): string {
  return CONTACT_CASES.map((c, i) => `  (${sqlString(c.text)}, ${c.kind === null ? "null" : `'${c.kind}'`})${i === CONTACT_CASES.length - 1 ? "" : ","}`).join("\n");
}

test("the SQL test carries the same table", () => {
  const sql = readFileSync(new URL("supabase/tests/contact_rule.test.sql", root), "utf8").replace(/\r\n/g, "\n");
  const block = sql.slice(sql.indexOf("-- cases:begin\n") + "-- cases:begin\n".length, sql.indexOf("\n-- cases:end"));
  const want = sqlCaseRows();
  assert.equal(block, want, `Paste this between -- cases:begin and -- cases:end in supabase/tests/contact_rule.test.sql:\n${want}`);
});
