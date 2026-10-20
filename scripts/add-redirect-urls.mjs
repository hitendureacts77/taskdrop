#!/usr/bin/env node
/**
 * Adds the redirect addresses listed under [auth] in supabase/config.toml to the test
 * project's allow-list, without removing or changing anything already there (the old app and
 * old admin keep signing in until Phase 9).
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/add-redirect-urls.mjs            show what would be added
 *   SUPABASE_ACCESS_TOKEN=... node scripts/add-redirect-urls.mjs --apply    add it
 *
 * The token is a personal access token (supabase.com -> Account -> Access Tokens). It is only
 * sent to api.supabase.com and never printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = "wjxvingpfbfvkfqhrguj";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (supabase.com -> Account -> Access Tokens).");
  process.exit(2);
}

const toml = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "supabase/config.toml"), "utf8");
const block = /^additional_redirect_urls\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1] ?? "";
const wanted = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (wanted.length === 0) throw new Error("No additional_redirect_urls found under [auth] in supabase/config.toml");

const api = `https://api.supabase.com/v1/projects/${PROJECT}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const res = await fetch(api, { headers });
if (!res.ok) throw new Error(`Could not read the auth settings: HTTP ${res.status}`);
const current = String((await res.json()).uri_allow_list ?? "");
const have = current.split(",").map((s) => s.trim()).filter(Boolean);
const add = wanted.filter((u) => !have.includes(u));

console.log(`${have.length} address(es) already allowed; ${add.length} to add${add.length ? ":\n" + add.map((u) => "  + " + u).join("\n") : "."}`);
if (add.length === 0) process.exit(0);
if (!process.argv.includes("--apply")) {
  console.log("Dry run. Pass --apply to add them.");
  process.exit(0);
}
const patch = await fetch(api, { method: "PATCH", headers, body: JSON.stringify({ uri_allow_list: [...have, ...add].join(",") }) });
if (!patch.ok) throw new Error(`The update was refused: HTTP ${patch.status}`);
console.log("ok  - added; the old addresses are still on the list");
