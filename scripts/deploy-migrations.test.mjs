import assert from "node:assert/strict";
import { ownsTransaction, pending } from "./deploy-migrations.mjs";
import { targetKind } from "./lib/db.mjs";

const history = [["20261018100000", "097_closeout"], ["20261019042823", "109_media_registry"], ["20261018110017", "108_account_deletion_erases_more"]];
const files = [
  "20260914150000_018_payout_cancel.sql", // old, never recorded by that name: assumed applied
  "20261018100000_097_closeout.sql", // recorded
  "20261019120000_108_account_deletion_erases_more.sql", // recorded under another version
  "20261019042823_109_media_registry.sql", // recorded
  "20261101000000_110_new_thing.sql", // new
  "20261102000000_111_another.sql", // new
  "README.md",
];
assert.deepEqual(pending(files, history).map((m) => m.file), ["20261101000000_110_new_thing.sql", "20261102000000_111_another.sql"]);
assert.deepEqual(pending(files, [["20261101000000", "110_new_thing"], ["20261019042823", "109_media_registry"]]).map((m) => m.file), ["20261102000000_111_another.sql"]);
console.log("ok  - deploy-migrations applies only new migrations");

assert.equal(ownsTransaction("begin;\ncreate table t();\ncommit;"), true);
assert.equal(ownsTransaction("create function f() returns void language plpgsql as $$\nbegin\n  null;\nend $$;"), false);
assert.equal(ownsTransaction("create table t();\n  COMMIT ;\n"), true); // indented, upper case, space before the semicolon
console.log("ok  - migration files that manage their own transaction are caught");

const ref = "wjxvingpfbfvkfqhrguj";
assert.equal(targetKind("postgresql://postgres:pw@127.0.0.1:54322/postgres"), "local");
assert.equal(targetKind(`postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`), "test");
assert.equal(targetKind(`postgresql://postgres.${ref}:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`), "test");
assert.equal(targetKind("postgresql://postgres.otherprojectref:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"), null);
assert.equal(targetKind(`postgresql://postgres:pw@db.${ref}.evil.example/postgres`), null);
assert.equal(targetKind(`postgresql://${ref}.evil:pw@evil.example/postgres`), null);
console.log("ok  - only localhost and the test project are accepted as database targets");
