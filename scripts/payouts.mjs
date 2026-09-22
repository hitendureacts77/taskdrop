#!/usr/bin/env node
/**
 * The payout queue, from a terminal.
 *
 * A worker's withdrawal debits their wallet the moment they ask for it and then
 * sits at 'requested' until a person sends the money and marks it. Nothing in
 * the product does that on its own -- there is no payout provider wired up,
 * deliberately, because every one of them charges per transfer and a UPI
 * transfer you make yourself is free.
 *
 * So this is the free path: it shows you exactly who to pay, how much, and to
 * which UPI id or bank account, hands you a upi:// link to do it from a phone,
 * and then records the result through admin_mark_payout -- which is what puts
 * the money back in the wallet if the transfer bounced. Marking rows by hand in
 * the table editor skips that refund.
 *
 *   npm run payouts                          list what is owed
 *   npm run payouts paid <id> [reference]    after the money has left
 *   npm run payouts failed <id> <reason>     bounced; refunds their wallet
 *   npm run payouts processing <id>          you have picked it up
 *
 * <id> may be any unique prefix of the payout id shown in the listing.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env. That key bypasses every policy in
 * the database, so this script is for your machine and never for a client.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// ------------------------------------------------------------------ setup ---

function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  for (const f of ['.env', 'apps/mobile/.env']) {
    try {
      const line = readFileSync(f, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(`${name}=`));
      if (line) return line.slice(line.indexOf('=') + 1).trim();
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const URL_BASE = (
  fromEnvFile('SUPABASE_URL') ??
  fromEnvFile('EXPO_PUBLIC_SUPABASE_URL') ??
  'https://wjxvingpfbfvkfqhrguj.supabase.co'
).replace(/\/+$/, '');
const SERVICE_KEY = fromEnvFile('SUPABASE_SERVICE_ROLE_KEY');

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const rupees = (minor) =>
  '₹' + (minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ageOf(iso) {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function rpc(fn, body = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message = parsed?.message ?? parsed?.error ?? text ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return parsed;
}

// ------------------------------------------------------------ destination ---

/** How to actually send it, in the words the operator needs. */
function destinationOf(row) {
  if (row.kind === 'upi' && row.upi_id) return { how: 'UPI', detail: row.upi_id };
  if (row.kind === 'bank' && row.account_number) {
    return {
      how: 'Bank',
      detail: `${row.account_name ?? ''} · ${row.account_number} · ${row.ifsc}`.trim(),
    };
  }
  // No live destination row. The snapshot is all there is, and for a bank
  // account it is masked -- say so rather than printing ····1234 as if it were
  // something you could pay into.
  if (row.snapshot && /@/.test(row.snapshot)) return { how: 'UPI', detail: row.snapshot };
  return {
    how: 'MISSING',
    detail: row.snapshot
      ? `${row.snapshot} — masked snapshot only, ask them to re-add the account`
      : 'no payout account on file — ask them to add one',
  };
}

/**
 * A upi:// link opens straight into a UPI app with the amount and note filled
 * in. Tapping it on a phone is the whole transfer; on a laptop it is a string
 * to send yourself. UPI moves no fee either way, which is the point.
 */
function upiLink(vpa, name, minor, ref) {
  const q = new URLSearchParams({
    pa: vpa,
    pn: name || 'TaskDrop worker',
    am: (minor / 100).toFixed(2),
    cu: 'INR',
    tn: `TaskDrop payout ${ref}`,
  });
  return `upi://pay?${q.toString()}`;
}

// ------------------------------------------------------------------ verbs ---

async function queue() {
  const rows = await rpc('admin_payout_queue');
  return Array.isArray(rows) ? rows : [];
}

async function list() {
  const rows = await queue();
  if (rows.length === 0) {
    console.log(`\n  ${green('Nothing owed.')} No payout is waiting to be sent.\n`);
    return;
  }

  const total = rows.reduce((n, r) => n + Number(r.amount_minor), 0);
  console.log(
    `\n  ${bold(`${rows.length} payout${rows.length === 1 ? '' : 's'} owed`)}, ${bold(rupees(total))} in total\n`,
  );

  for (const row of rows) {
    const { how, detail } = destinationOf(row);
    const short = row.id.slice(0, 8);
    const flag = how === 'MISSING' ? red('  CANNOT SEND') : '';
    console.log(
      `  ${bold(rupees(Number(row.amount_minor)).padStart(12))}  ${(row.display_name ?? 'Unknown').padEnd(20)} ${dim(short)}  ${dim(ageOf(row.requested_at))}${row.status === 'processing' ? yellow('  processing') : ''}${flag}`,
    );
    console.log(`  ${' '.repeat(12)}  ${how === 'MISSING' ? red(detail) : `${how}  ${detail}`}`);
    if (how === 'UPI') {
      console.log(`  ${' '.repeat(12)}  ${dim(upiLink(detail, row.display_name, Number(row.amount_minor), short))}`);
    }
    console.log();
  }

  console.log(dim('  Send the money, then record it:'));
  console.log(dim(`    npm run payouts paid ${rows[0].id.slice(0, 8)} <upi reference>`));
  console.log(dim(`    npm run payouts failed ${rows[0].id.slice(0, 8)} "bank rejected the VPA"\n`));
}

/** Accept any unique prefix of an id, so nobody has to retype a uuid. */
async function resolve(prefix) {
  const rows = await queue();
  const hits = rows.filter((r) => r.id.startsWith(prefix));
  if (hits.length === 0) {
    throw new Error(
      `No payout waiting whose id starts with "${prefix}". Run \`npm run payouts\` to see the queue.`,
    );
  }
  if (hits.length > 1) {
    throw new Error(`"${prefix}" matches ${hits.length} payouts. Use more of the id.`);
  }
  return hits[0];
}

async function mark(status, prefix, note) {
  if (!prefix) throw new Error(`Which payout? \`npm run payouts ${status} <id>\``);
  if (status === 'failed' && !note) {
    throw new Error('Say why it failed: `npm run payouts failed <id> "bank rejected the VPA"`');
  }

  const row = await resolve(prefix);
  const { how, detail } = destinationOf(row);
  const amount = rupees(Number(row.amount_minor));

  console.log();
  if (status === 'paid') {
    console.log(`  Recording ${bold(amount)} as sent to ${bold(row.display_name ?? 'this worker')} (${how} ${detail}).`);
    console.log(`  ${yellow('This cannot be undone, and it does not send anything.')} Only say yes if the money has left.`);
  } else if (status === 'failed') {
    console.log(`  Marking ${bold(amount)} to ${bold(row.display_name ?? 'this worker')} as failed.`);
    console.log(`  ${amount} goes back into their wallet and they can withdraw it again.`);
  } else {
    console.log(`  Marking ${bold(amount)} to ${bold(row.display_name ?? 'this worker')} as being sent.`);
    console.log(`  ${dim('They can no longer cancel it themselves.')}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Go ahead? [y/N] ')).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') {
    console.log(`  ${dim('Left alone.')}\n`);
    return;
  }

  await rpc('admin_mark_payout', {
    p_payout_id: row.id,
    p_status: status,
    p_note: note ?? null,
  });
  console.log(`  ${green('Done.')} ${amount} is now ${bold(status)}.\n`);
}

// ------------------------------------------------------------------- main ---

const [verb, ...rest] = process.argv.slice(2);

if (!SERVICE_KEY) {
  console.error(
    `\n  ${red('SUPABASE_SERVICE_ROLE_KEY is not set.')}\n\n  Put it in .env — Supabase dashboard → Project Settings → API → service_role.\n  It bypasses every row-level policy, so keep it on this machine.\n`,
  );
  process.exit(1);
}

try {
  switch (verb) {
    case undefined:
    case 'list':
      await list();
      break;
    case 'paid':
    case 'failed':
    case 'processing':
      await mark(verb, rest[0], rest.slice(1).join(' ') || null);
      break;
    default:
      console.error(
        `\n  Unknown command "${verb}".\n\n    npm run payouts\n    npm run payouts paid <id> [reference]\n    npm run payouts failed <id> <reason>\n    npm run payouts processing <id>\n`,
      );
      process.exit(1);
  }
} catch (err) {
  console.error(`\n  ${red('Stopped:')} ${err.message}\n`);
  process.exit(1);
}
