import assert from "node:assert/strict";
import { pending } from "./deploy-migrations.mjs";

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
