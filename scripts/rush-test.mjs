#!/usr/bin/env node
/**
 * A rush and an abuse test (docs/ULTIMATE_PLAN.md task 2.13 part J, hole H29). STAGING only: fake accounts,
 * fake data, the free plan. No real SMS is sent (staging answers with the code instead) and no money moves.
 *
 *   node scripts/rush-test.mjs rush    many people using the app at once, stepping up until something slows or fails
 *   node scripts/rush-test.mjs spam    one person hammering every limit; each must start refusing, and a bystander must keep working
 *   node scripts/rush-test.mjs         both
 *
 * "A person" in the rush is a loop that does one thing every few seconds. The three seed accounts carry them all,
 * each account within its own per-minute limit, so the number it reports is "people using the app together",
 * not the highest the database could take. It is a floor, not a promise (staging is the free plan).
 *
 * Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values). Exit 1 if a limit did not hold.
 */
import { URL as BASE, api, headers, phoneAuth, signIn } from './lib/staging-session.mjs';

const which = process.argv[2] ?? 'all';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const findings = [];
const bad = (what) => findings.push(what);

/** One call to any of our functions, as a signed-in person. Never throws. */
async function fn(name, token, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/functions/v1/${name}`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    await res.text();
    return { status: res.status, ms: Date.now() - t0 };
  } catch {
    return { status: 0, ms: Date.now() - t0 };
  }
}

// ------------------------------------------------------------------------------------------ the rush
const SCREENS = [
  ['listOpenTasks', { limit: 20 }], ['getWallet', {}], ['listMyTasks', {}], ['listNotifications', {}], ['countUnreadNotifications', {}],
  ['platformStats', {}], ['trendingCategories', {}], ['listThreads', {}], ['remoteTasks', {}], ['listMyBids', {}],
];

async function rush(tokens) {
  const steps = [10, 20, 40, 60];
  const seconds = 20;
  const rows = [];
  let broke = null;
  for (const people of steps) {
    const lat = [];
    let errors = 0, limited = 0, total = 0;
    const until = Date.now() + seconds * 1000;
    await Promise.all(
      Array.from({ length: people }, async (_, i) => {
        const token = tokens[i % tokens.length];
        await wait(Math.random() * 4000);
        while (Date.now() < until) {
          const [op, args] = SCREENS[Math.floor(Math.random() * SCREENS.length)];
          const t0 = Date.now();
          const r = await api(token, op, args);
          lat.push(Date.now() - t0);
          total++;
          if (r.status === 429) limited++;
          else if (r.status >= 400 || r.status === 0 || (r.json && r.json.ok === false)) errors++;
          await wait(4000 + Math.random() * 2000);
        }
      }),
    );
    lat.sort((a, b) => a - b);
    const row = { people, calls: total, p50: pct(lat, 50), p95: pct(lat, 95), max: lat.at(-1) ?? 0, errors, limited };
    rows.push(row);
    console.log(`${String(people).padStart(3)} people  ${String(total).padStart(4)} calls  p50 ${row.p50} ms  p95 ${row.p95} ms  max ${row.max} ms  errors ${errors}  asked to wait ${limited}`);
    if (!broke && (errors / Math.max(1, total) > 0.02 || row.p95 > 3000)) broke = row;
    if (errors / Math.max(1, total) > 0.1) break;
  }
  if (broke) console.log(`First slowdown or failure at ${broke.people} people at once (p95 ${broke.p95} ms, ${broke.errors} errors).`);
  else console.log(`No slowdown or failures up to ${steps.at(-1)} people at once.`);
  const worst = rows.at(-1);
  if (worst && worst.errors > 0) bad(`rush: ${worst.errors} wrong or failed answers at ${worst.people} people`);
  return rows;
}

// ------------------------------------------------------------------------------------------ the spammer
/** Sends n calls, `parallel` at a time, and says when the first refusal came (1-based) and how many there were. */
async function hammer(n, send, parallel = 5) {
  let next = 0, first = 0, refused = 0, errors = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (;;) {
        const i = ++next;
        if (i > n) return;
        const r = await send(i);
        if (r.status === 429) {
          refused++;
          if (!first || i < first) first = i;
        } else if (r.status >= 500 || r.status === 0) errors++;
      }
    }),
  );
  return { first, refused, errors };
}

async function spam(spammer, bystander) {
  // The bystander does one ordinary thing a second the whole time.
  let stop = false, bystanderCalls = 0, bystanderFailed = 0;
  const watcher = (async () => {
    while (!stop) {
      const r = await api(bystander.token, 'getWallet');
      bystanderCalls++;
      if (r.status !== 200) bystanderFailed++;
      await wait(1000);
    }
  })();

  const check = (name, got, limit) => {
    const ok = got.refused > 0 && got.first > 0 && got.first <= limit + 15 && got.errors === 0;
    console.log(`${ok ? 'held  ' : 'FAILED'}  ${name}: first refusal at call ${got.first || 'never'}, ${got.refused} refused, ${got.errors} server errors (limit ${limit}/min)`);
    if (!ok) bad(`spam: ${name} did not start refusing near its limit of ${limit} a minute (${JSON.stringify(got)})`);
  };

  check('api reads (getWallet)', await hammer(340, () => api(spammer.token, 'getWallet'), 8), 300);
  await wait(61_000);
  check('api writes (touchPresence)', await hammer(80, () => api(spammer.token, 'touchPresence', {}), 4), 60);
  await wait(61_000);
  check('api uploads (createUpload)', await hammer(30, () => api(spammer.token, 'createUpload', {}), 3), 20);
  await wait(61_000);
  check('withdrawals (razorpayx-payouts)', await hammer(26, () => fn('razorpayx-payouts', spammer.token, { action: 'bogus' }), 3), 20);
  await wait(61_000);
  check('payments (razorpay)', await hammer(36, () => fn('razorpay', spammer.token, { action: 'bogus' }), 3), 30);

  // Asking for sign-in codes for one number over and over: the first goes out, the rest wait out the cooldown.
  const codes = await hammer(5, () => phoneAuth({ action: 'send', phone: '9990000099', mode: 'signin' }).then((r) => ({ status: r.status })), 1);
  console.log(`${codes.refused >= 3 ? 'held  ' : 'FAILED'}  sign-in codes (phone-auth): ${codes.refused} of 5 asks for one number were refused`);
  if (codes.refused < 3) bad('spam: asking for sign-in codes for one number again and again was not refused');

  // Guessing a username's password again and again.
  const guesses = await hammer(15, () => fn('password-auth', headers.apikey, { username: 'nobody_here_xyz', password: 'wrong-guess-1' }), 1);
  console.log(`${guesses.refused > 0 ? 'held  ' : 'FAILED'}  password guesses (password-auth): ${guesses.refused} of 15 were refused`);
  if (guesses.refused === 0) bad('spam: guessing a password 15 times was never refused');

  stop = true;
  await watcher;
  const okRate = 1 - bystanderFailed / Math.max(1, bystanderCalls);
  console.log(`${okRate >= 0.97 ? 'held  ' : 'FAILED'}  the other person kept working: ${bystanderCalls - bystanderFailed} of ${bystanderCalls} calls answered`);
  if (okRate < 0.97) bad(`spam: another person's calls failed while one person was spamming (${bystanderFailed} of ${bystanderCalls})`);
}

// ------------------------------------------------------------------------------------------ run
async function main() {
  const [meera, ravi, asha] = [await signIn('9990000003'), await signIn('9990000002'), await signIn('9990000001')];
  if (which === 'rush' || which === 'all') {
    console.log('\n== The rush: people using the app at once ==');
    await rush([meera.token, ravi.token, asha.token]);
  }
  if (which === 'spam' || which === 'all') {
    console.log('\n== The spammer: every limit must start refusing ==');
    await spam(meera, ravi);
  }
}

main()
  .then(() => {
    for (const f of findings) console.log('FAIL  ' + f);
    console.log(findings.length ? `\n${findings.length} problem(s).` : '\nEvery limit held.');
    process.exit(findings.length ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
