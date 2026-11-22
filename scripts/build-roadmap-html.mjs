#!/usr/bin/env node
// Builds docs/roadmap/ROADMAP.html (one self-contained file) from docs/ULTIMATE_PLAN.md.
// Rebuild any time:  node scripts/build-roadmap-html.mjs
//
// What it reads from the plan (tolerant: anything it cannot read is skipped, never fatal):
//   - "## START NOW", "## STEP n", "## FUTURE SCOPE" headings and their "In plain words" line
//   - every <details id="t..."> task: number, short label, who, status note, one-line "why"
//   - every "> **GATE ...**" block and the [x] / [ ] / [-] checks under it
// Status of a task comes from the same rule the plan page uses:
//   "Done" at the start of the grey note = done; [LATER] tag = future scope (not counted);
//   "built / merged / part done / running" without "not started" = in progress; else next.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const planPath = resolve(root, 'docs', 'ULTIMATE_PLAN.md');
const outPath = resolve(root, 'docs', 'roadmap', 'ROADMAP.html');

const md = readFileSync(planPath, 'utf8').replace(/\r\n/g, '\n');

// ---------- helpers ----------
function plain(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstSentence(s, max = 170) {
  s = plain(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  if (dot > 50) return cut.slice(0, dot + 1);
  return cut.replace(/\s+\S*$/, '') + '...';
}
function sentenceOrShort(s, max = 170) {
  s = plain(s);
  const m = s.match(/^(.{40,}?[.!?])(\s|$)/);
  if (m && m[1].length <= max) return m[1];
  return firstSentence(s, max);
}

// ---------- phases ----------
const PHASES = [
  { key: 'S', num: 'S', name: 'Start now', heading: /^## START NOW/m, short: 'The slow paperwork' },
  { key: '1', num: '1', name: 'Features', heading: /^## STEP 1\b/m, short: 'Finish, then freeze' },
  { key: '2', num: '2', name: 'Safety', heading: /^## STEP 2\b/m, short: 'Make it hacker-proof' },
  { key: '3', num: '3', name: 'Testers', heading: /^## STEP 3\b/m, short: 'Prove it with real people' },
  { key: '4', num: '4', name: 'Marketing', heading: /^## STEP 4\b/m, short: 'Get ready to market' },
  { key: '5', num: '5', name: 'Production', heading: /^## STEP 5\b/m, short: 'Build the real copy' },
  { key: '6', num: '6', name: 'Launch', heading: /^## STEP 6\b/m, short: 'Launch one city' },
  { key: '7', num: '7', name: 'Run and grow', heading: /^## STEP 7\b/m, short: 'The first 90 days' },
  { key: 'F', num: 'F', name: 'Later', heading: /^## FUTURE SCOPE/m, short: 'Ideas for after launch' },
];
for (const p of PHASES) {
  p.items = [];
  p.gates = [];
  const m = p.heading.exec(md);
  p.when = '';
  p.plain = '';
  if (m) {
    const lineEnd = md.indexOf('\n', m.index);
    const headLine = md.slice(m.index, lineEnd);
    const w = headLine.match(/\(([^)]*(?:week|day|Gate|city)[^)]*)\)\s*$/i);
    if (w) p.when = plain(w[1]);
    const after = md.slice(lineEnd, lineEnd + 3000);
    const pw = after.match(/\*\*In plain words:?\*\*:?\s*([^\n]+)/);
    if (pw) p.plain = sentenceOrShort(pw[1], 220);
  }
}
const phaseByKey = Object.fromEntries(PHASES.map((p) => [p.key, p]));

// ---------- tasks ----------
const TAGS = { YOU: 'You', CLAUDE: 'Claude', BOTH: 'You + Claude', LATER: 'Later' };
function statusOf(tag, note, parkedOrDeferred) {
  const n = note.toLowerCase();
  if (/(^|·)\s*done\b/i.test(note)) return 'done';
  if (tag === 'LATER' || parkedOrDeferred) return 'future';
  if (/\bnot (yet )?(started|run)\b|nothing built/.test(n)) return 'next';
  if (/\b(built|building|merged|started|running)\b|\bparts? run\b|\b(part|proofs?|rounds?|code|[ht]\d+)\b[^·]*\bdone\b|\bdone\b[^·]*\b(live|on staging)\b/.test(n)) return 'progress';
  return 'next';
}
const taskRe = /<details id="t([^"]+)"([^>]*)>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
let tm;
let skipped = 0;
while ((tm = taskRe.exec(md))) {
  const id = tm[1];
  const attrs = tm[2];
  const sum = tm[3];
  const body = tm[4];
  const phaseKey = id[0] === 'S' ? 'S' : id[0] === 'F' ? 'F' : id[0];
  const phase = phaseByKey[phaseKey];
  if (!phase) { skipped++; continue; }
  const tagM = sum.match(/\[([A-Z]+)\]/);
  const tag = tagM ? tagM[1] : 'BOTH';
  const numM = sum.match(/<b>\s*([^<]+?)\s*<\/b>/);
  const num = numM ? plain(numM[1]) : id.replace(/^(\d)-/, '$1.').replace(/^([SF])-/, '$1.');
  const afterB = sum.replace(/^[\s\S]*?<\/b>/, '');
  const titleRaw = afterB.split(/<small>/)[0];
  const smallM = sum.match(/<small>([\s\S]*?)<\/small>/);
  const note = smallM ? plain(smallM[1]).replace(/^·\s*/, '') : '';
  const noteForStatus = smallM ? plain(smallM[1]) : '';
  const shortM = attrs.match(/data-short="([^"]*)"/);
  const title = plain(titleRaw);
  const short = shortM ? plain(shortM[1]) : firstSentence(title, 36);
  const parked = /\b(parked|deferred)\b/i.test(note);
  const status = statusOf(tag, noteForStatus, parked);
  // one-line description
  let desc = '';
  const why = body.match(/\*\*Why:?\*\*:?\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/);
  if (why) desc = why[1];
  if (!desc) {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || /^(<|[-*|>#]|\d+[.)]\s|```|\*\*Done when)/.test(t)) continue;
      desc = t; break;
    }
  }
  desc = sentenceOrShort(desc || title, 190);
  phase.items.push({ id: num, short, title: firstSentence(title, 140), tag: TAGS[tag] || 'You + Claude', status, note: firstSentence(note, 140), desc });
}

// ---------- gates ----------
const GATE_HOME = { '1': '1', '2a': '2', '2b': '2', '3': '3', '4': '4', '5': '5', '6': '6' };
const lines = md.split('\n');
for (let i = 0; i < lines.length; i++) {
  const g = lines[i].match(/^>\s*\*\*GATE (\d+[ab]?)\b[^*]*\*\*\s*(.*)$/);
  if (!g) continue;
  const key = g[1];
  const home = phaseByKey[GATE_HOME[key] || ''];
  if (!home) continue;
  const checks = [];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    const b = l.match(/^- \[( |x|X|-)\]\s+(.*)$/);
    if (b) {
      checks.push({ state: b[1] === ' ' ? 'open' : b[1] === '-' ? 'future' : 'done', text: firstSentence(b[2].replace(/\*\*Checked[\s\S]*$/, '').replace(/\*\*[A-Z][^*]*\*\*[\s\S]*$/, (m) => m.length > 60 ? '' : m), 150) });
      continue;
    }
    if (l.trim() === '' || /^\s+\S/.test(l)) continue;
    break;
  }
  const head = plain(lines[i].replace(/^>\s*/, '')).replace(/^GATE\s*/i, '');
  home.gates.push({ key, title: head, checks });
}

// ---------- counts ----------
const summary = [];
let T = { done: 0, progress: 0, next: 0, future: 0 };
for (const p of PHASES) {
  const c = { done: 0, progress: 0, next: 0, future: 0 };
  for (const it of p.items) c[it.status]++;
  p.counts = c;
  p.counted = c.done + c.progress + c.next;
  if (p.key !== 'F') for (const k of Object.keys(T)) T[k] += c[k];
  else T.future += 0; // future-scope phase is not part of the progress
  summary.push(`${p.num.padEnd(2)} ${p.name.padEnd(13)} tasks ${String(p.items.length).padStart(3)}  done ${String(c.done).padStart(2)}  in progress ${String(c.progress).padStart(2)}  next ${String(c.next).padStart(2)}  future ${String(c.future).padStart(2)}  gates ${p.gates.map((g) => g.key + ' ' + g.checks.filter((x) => x.state === 'done').length + '/' + g.checks.filter((x) => x.state !== 'future').length).join(', ') || '-'}`);
}
const futureScopeCount = phaseByKey.F.items.length;
const allTasks = PHASES.reduce((a, p) => a + p.items.length, 0);
const counted = T.done + T.progress + T.next;

// ---------- html ----------
const data = {
  generated: new Date().toISOString().slice(0, 10),
  totals: { done: T.done, progress: T.progress, next: T.next, future: T.future + futureScopeCount, counted },
  phases: PHASES.map((p) => ({ key: p.key, num: p.num, name: p.name, short: p.short, when: p.when, plain: p.plain, counts: p.counts, counted: p.counted, items: p.items, gates: p.gates })),
};
const json = JSON.stringify(data).split("<").join("\u003c").split(String.fromCharCode(8232)).join("").split(String.fromCharCode(8233)).join("");

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TaskDrop Roadmap</title>
<meta name="description" content="How TaskDrop gets to launch: every phase, task and gate from the plan, with what is done.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Patrick+Hand&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #fbfaf5;
  --ink: #1d2733;
  --muted: #6b7684;
  --line: #4a8cf0;
  --phase: #cfe5ff;
  --phase-line: #4a8cf0;
  --topic: #ffe68a;
  --topic-line: #cfa92a;
  --topic-ink: #3a3010;
  --panel: #ffffff;
  --panel-line: #8fb5ee;
  --done: #23995a;
  --prog: #2f7bf0;
  --future: #8b94a0;
  --card: #ffffff;
  --shadow: rgba(29, 39, 51, .18);
  --gate: #fff3d6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #12161d; --ink: #e8edf4; --muted: #9aa5b4; --line: #5b9bff;
    --phase: #1f3a5f; --phase-line: #5b9bff; --topic: #4f4413; --topic-line: #a8902b; --topic-ink: #fbefc1;
    --panel: #1a212b; --panel-line: #3d5f94; --done: #4cc98a; --prog: #6aa6ff; --future: #8c96a4;
    --card: #1a212b; --shadow: rgba(0, 0, 0, .5); --gate: #3a3220;
  }
}
:root[data-theme="dark"] {
  --bg: #12161d; --ink: #e8edf4; --muted: #9aa5b4; --line: #5b9bff;
  --phase: #1f3a5f; --phase-line: #5b9bff; --topic: #4f4413; --topic-line: #a8902b; --topic-ink: #fbefc1;
  --panel: #1a212b; --panel-line: #3d5f94; --done: #4cc98a; --prog: #6aa6ff; --future: #8c96a4;
  --card: #1a212b; --shadow: rgba(0, 0, 0, .5); --gate: #3a3220;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: "Patrick Hand", "Kalam", "Comic Sans MS", cursive, sans-serif; font-size: 17px; line-height: 1.25; }
button { font: inherit; color: inherit; }

header.top { padding: 18px 16px 10px; max-width: 1100px; margin: 0 auto; text-align: center; }
h1 { font-family: "Kalam", "Patrick Hand", cursive; font-size: clamp(30px, 6vw, 52px); margin: 0 0 4px; font-weight: 700; letter-spacing: .5px; }
.sub { color: var(--muted); margin: 0 0 12px; font-size: 18px; }
.overall { display: flex; align-items: center; gap: 12px; max-width: 640px; margin: 0 auto; }
.bar { flex: 1; height: 18px; border: 2px solid var(--line); border-radius: 12px 14px 11px 13px / 13px 11px 14px 12px; background: var(--card); overflow: hidden; display: flex; }
.bar i { display: block; height: 100%; }
.bar .b-done { background: var(--done); }
.bar .b-prog { background: var(--prog); opacity: .55; }
.overall b { white-space: nowrap; font-size: 18px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: center; margin: 10px 0 0; font-size: 15px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.theme { position: absolute; top: 10px; right: 12px; border: 2px solid var(--line); background: var(--card); border-radius: 10px; padding: 3px 10px; cursor: pointer; }

.stage { position: relative; }
.viewport { position: relative; height: calc(100vh - 175px); min-height: 480px; overflow: hidden; border-top: 2px dashed var(--panel-line); cursor: grab; touch-action: none; }
.viewport.drag { cursor: grabbing; }
.zoom { position: absolute; top: 10px; left: 10px; z-index: 20; display: flex; gap: 6px; }
.zoom button { width: 40px; height: 40px; border: 2px solid var(--line); border-radius: 12px 10px 13px 11px; background: var(--card); font-size: 22px; line-height: 1; cursor: pointer; box-shadow: 2px 2px 0 var(--shadow); }
.zoom button.fit { width: auto; padding: 0 12px; font-size: 16px; }
.zoom button:hover { background: var(--phase); }
.zoomlvl { align-self: center; color: var(--muted); font-size: 14px; min-width: 40px; }
#canvas { position: absolute; left: 0; top: 0; width: 1500px; transform-origin: 0 0; padding: 30px 0 80px; }
svg#links { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
svg#links path { fill: none; stroke: var(--line); stroke-width: 2.4; stroke-linecap: round; }
svg#links path.dot { stroke-dasharray: 2 7; stroke-width: 2.6; }

.phase { position: relative; display: grid; grid-template-columns: 1fr 250px 1fr; align-items: start; margin-bottom: 14px; }
.center { position: relative; display: flex; flex-direction: column; align-items: center; align-self: stretch; }
.center::before { content: ""; position: absolute; left: 50%; top: 0; bottom: -14px; width: 0; border-left: 3px solid var(--line); transform: translateX(-1.5px); z-index: 0; }
.pbox { position: relative; z-index: 2; width: 232px; background: var(--phase); border: 3px solid var(--phase-line); border-radius: 18px 22px 16px 24px / 22px 16px 24px 18px; padding: 10px 12px 10px; text-align: center; cursor: pointer; box-shadow: 4px 4px 0 var(--shadow); }
.pbox:hover { transform: rotate(-.6deg); }
.pbox h2 { font-family: "Kalam", "Patrick Hand", cursive; font-size: 25px; margin: 0; line-height: 1.1; }
.pbox .pshort { font-size: 15px; color: var(--muted); margin-top: 1px; }
.pbox .pcount { font-size: 17px; margin-top: 5px; font-weight: 700; }
.pbox .pbar { height: 9px; margin-top: 5px; border: 2px solid var(--phase-line); border-radius: 8px; background: var(--card); overflow: hidden; display: flex; }
.pbox .pbar i { display: block; height: 100%; }
.pbox .pbar .b-done { background: var(--done); }
.pbox .pbar .b-prog { background: var(--prog); opacity: .55; }
.pbox .plater { font-size: 14px; color: var(--muted); }

.gate { position: relative; z-index: 2; margin-top: 16px; background: var(--gate); border: 2.5px solid var(--topic-line); border-radius: 14px 18px 13px 17px / 17px 13px 18px 14px; padding: 5px 12px; cursor: pointer; font-size: 16px; display: flex; gap: 8px; align-items: center; box-shadow: 3px 3px 0 var(--shadow); max-width: 232px; }
.gate:hover { transform: rotate(.7deg); }
.gate .gk { font-weight: 700; }
.gate .gn { color: var(--muted); }
.gate.ok { border-color: var(--done); }

.stack { display: flex; flex-direction: column; gap: 9px; padding: 4px 0; min-width: 0; position: relative; z-index: 1; }
.stack.left { align-items: flex-end; padding-right: 74px; }
.stack.right { align-items: flex-start; padding-left: 74px; }
.row { display: flex; align-items: center; }
.stack.left .row { flex-direction: row-reverse; }
.row .tie { width: 26px; border-top: 2.6px dotted var(--line); flex: none; }
.topic { position: relative; width: 252px; display: flex; gap: 7px; align-items: flex-start; text-align: left; background: var(--topic); color: var(--topic-ink); border: 2.5px solid var(--topic-line); border-radius: 11px 14px 10px 13px / 13px 10px 14px 11px; padding: 6px 9px; cursor: pointer; box-shadow: 3px 3px 0 var(--shadow); font-size: 17px; line-height: 1.15; flex: none; }
.topic:hover, .chip:hover { transform: translateY(-1px) rotate(-.4deg); }
.topic .num { font-weight: 700; margin-right: 4px; }
.ico { flex: none; width: 17px; height: 17px; margin-top: 1px; display: inline-grid; place-items: center; font-size: 14px; font-weight: 700; }
.st-done { opacity: .62; }
.st-done .ico { color: #fff; background: var(--done); border-radius: 50%; }
.st-done .lbl { text-decoration: line-through; text-decoration-thickness: 1.5px; }
.st-progress .ico::before { content: ""; width: 11px; height: 11px; border-radius: 50%; background: var(--prog); box-shadow: 0 0 0 3px rgba(47, 123, 240, .25); }
.st-next .ico::before { content: ""; width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--topic-line); }
.topic.st-future { background: var(--card); color: var(--muted); border: 2.5px dashed var(--future); box-shadow: none; }
.st-future .ico::before { content: ""; width: 9px; height: 9px; border-radius: 50%; border: 2px dashed var(--future); }
.who { font-size: 12px; color: var(--muted); }

.side { width: 200px; background: var(--panel); border: 2px dashed var(--panel-line); border-radius: 14px 12px 15px 13px / 12px 15px 13px 14px; padding: 6px; display: flex; flex-direction: column; gap: 5px; flex: none; }
.side .cap { font-size: 13px; color: var(--muted); padding: 0 3px; }
.chip { display: flex; gap: 6px; align-items: flex-start; text-align: left; background: var(--topic); color: var(--topic-ink); border: 2px solid var(--topic-line); border-radius: 9px 11px 8px 10px; padding: 3px 7px; cursor: pointer; font-size: 15px; line-height: 1.1; }
.chip.st-future { background: var(--card); border-style: dashed; border-color: var(--future); color: var(--muted); }
.chip .ico { width: 15px; height: 15px; font-size: 12px; }
.row.orphan .tie { display: none; }

.pop { position: fixed; z-index: 100; width: min(340px, calc(100vw - 24px)); background: var(--card); color: var(--ink); border: 3px solid var(--line); border-radius: 16px 20px 15px 19px / 19px 15px 20px 16px; padding: 12px 14px 12px; box-shadow: 6px 6px 0 var(--shadow); display: none; max-height: 70vh; overflow: auto; }
.pop.show { display: block; }
.pop .pn { font-family: "Kalam", cursive; font-size: 22px; font-weight: 700; padding-right: 26px; }
.pop .pd { margin: 6px 0; font-size: 18px; }
.pop .ps { display: inline-flex; gap: 6px; align-items: center; font-weight: 700; padding: 1px 10px 1px 6px; border-radius: 99px; border: 2px solid var(--line); font-size: 16px; }
.pop .pm { color: var(--muted); font-size: 15px; margin-top: 6px; }
.pop .px { position: absolute; top: 6px; right: 8px; border: 0; background: transparent; font-size: 22px; cursor: pointer; line-height: 1; }
.pop ul { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 16px; }
.pop li { display: flex; gap: 6px; align-items: flex-start; }
.pop li .ico { margin-top: 2px; }
.pop li.st-done { opacity: .7; }
.pop .ico { display: inline-grid; }
.foot { text-align: center; color: var(--muted); font-size: 14px; padding: 8px 16px 24px; }

/* phone: stack phases vertically, no pan/zoom, no horizontal scroll */
@media (max-width: 759px) {
  body { overflow-x: hidden; font-size: 17px; }
  .theme { position: static; display: block; margin: 8px auto 0; }
  .viewport { height: auto; min-height: 0; overflow: visible; cursor: auto; touch-action: auto; border-top: 0; }
  .zoom, svg#links { display: none; }
  #canvas { position: relative; width: auto; transform: none !important; padding: 8px 16px 40px 16px; }
  .phase { display: block; margin: 0 0 18px; padding-left: 22px; border-left: 3px solid var(--line); }
  .center { display: block; align-self: auto; }
  .center::before { display: none; }
  .pbox { width: 100%; margin-left: -3px; text-align: left; }
  .pbox:hover, .gate:hover { transform: none; }
  .gate { max-width: none; margin-top: 10px; }
  .stack, .stack.left, .stack.right { padding: 0; align-items: stretch; margin-top: 8px; }
  .stack:empty { display: none; }
  .row, .stack.left .row { flex-direction: column; align-items: stretch; }
  .row .tie { display: none; }
  .topic, .side { width: 100%; }
  .side { margin: 4px 0 2px 14px; width: calc(100% - 14px); }
}
@media print { .zoom, .theme { display: none; } .viewport { height: auto; overflow: visible; } #canvas { position: relative; } }
</style>
</head>
<body>
<header class="top">
  <button class="theme" id="themeBtn" type="button" aria-label="Switch light or dark">Light / dark</button>
  <h1>How TaskDrop gets to launch</h1>
  <p class="sub">Every step from the plan, in order. Click any box to see what it is.</p>
  <div class="overall"><div class="bar" id="obar"></div><b id="otext"></b></div>
  <div class="legend">
    <span><i class="ico" style="background:var(--done);color:#fff;border-radius:50%">&#10003;</i> done</span>
    <span><i class="ico st-progress"></i> in progress</span>
    <span><i class="ico st-next"></i> next</span>
    <span><i class="ico st-future"></i> later (not counted)</span>
  </div>
</header>
<div class="stage">
  <div class="viewport" id="viewport">
    <div class="zoom" id="zoom">
      <button type="button" id="zin" aria-label="Zoom in">+</button>
      <button type="button" id="zout" aria-label="Zoom out">&minus;</button>
      <button type="button" id="zfit" class="fit" aria-label="Fit to width">Fit</button>
      <span class="zoomlvl" id="zlvl"></span>
    </div>
    <div id="canvas"><svg id="links" aria-hidden="true"></svg><div id="phases"></div></div>
  </div>
</div>
<div class="foot">Built from docs/ULTIMATE_PLAN.md on <span id="gen"></span>. Rebuild: node scripts/build-roadmap-html.mjs</div>
<div class="pop" id="pop" role="dialog" aria-live="polite"><button class="px" id="px" type="button" aria-label="Close">&times;</button><div id="popc"></div></div>

<script>
(function () {
  var DATA = __DATA__;
  var ST = { done: 'Done', progress: 'In progress', next: 'Next', future: 'Later (not counted)' };
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(st) { var i = el('span', 'ico'); if (st === 'done') i.textContent = '✓'; return i; }

  /* ---- theme ---- */
  var root = document.documentElement;
  try { var saved = localStorage.getItem('td-roadmap-theme'); if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved); } catch (e) {}
  $('themeBtn').addEventListener('click', function () {
    var dark = root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('td-roadmap-theme', next); } catch (e) {}
  });

  /* ---- overall progress ---- */
  var t = DATA.totals;
  var pct = function (n, d) { return d ? (100 * n / d) : 0; };
  var ob = $('obar');
  var b1 = el('i', 'b-done'); b1.style.width = pct(t.done, t.counted) + '%';
  var b2 = el('i', 'b-prog'); b2.style.width = pct(t.progress, t.counted) + '%';
  ob.appendChild(b1); ob.appendChild(b2);
  $('otext').textContent = t.done + ' of ' + t.counted + ' done (' + Math.round(pct(t.done, t.counted)) + '%)';
  $('gen').textContent = DATA.generated;

  /* ---- popover ---- */
  var pop = $('pop'), popc = $('popc');
  function closePop() { pop.classList.remove('show'); }
  function openPop(node, anchor, ev) {
    popc.textContent = '';
    node(popc);
    pop.classList.add('show');
    var w = pop.offsetWidth, h = pop.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var narrow = vw < 760;
    if (narrow) { pop.style.left = '12px'; pop.style.right = 'auto'; pop.style.top = 'auto'; pop.style.bottom = '12px'; return; }
    var r = anchor.getBoundingClientRect();
    var x = r.right + 12; if (x + w > vw - 8) x = r.left - w - 12; if (x < 8) x = Math.max(8, Math.min(vw - w - 8, r.left));
    var y = Math.max(8, Math.min(vh - h - 8, r.top));
    pop.style.left = x + 'px'; pop.style.top = y + 'px'; pop.style.bottom = 'auto'; pop.style.right = 'auto';
  }
  $('px').addEventListener('click', closePop);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });
  document.addEventListener('pointerdown', function (e) { if (pop.classList.contains('show') && !pop.contains(e.target) && !e.target.closest('[data-pop]')) closePop(); });

  function taskPanel(it) {
    return function (c) {
      c.appendChild(el('div', 'pn', it.id + '  ' + it.short));
      var ps = el('div', 'ps'); ps.className = 'ps st-' + it.status; ps.appendChild(icon(it.status)); ps.appendChild(document.createTextNode(ST[it.status]));
      c.appendChild(ps);
      c.appendChild(el('div', 'pd', it.desc));
      c.appendChild(el('div', 'pm', 'Who: ' + it.tag + (it.note ? '  ·  ' + it.note : '')));
    };
  }
  function phasePanel(p) {
    return function (c) {
      c.appendChild(el('div', 'pn', p.num + '. ' + p.name));
      if (p.plain) c.appendChild(el('div', 'pd', p.plain));
      var k = p.counts;
      c.appendChild(el('div', 'pm', k.done + ' done, ' + k.progress + ' in progress, ' + k.next + ' next' + (k.future ? ', ' + k.future + ' later' : '') + (p.when ? '  ·  ' + p.when : '')));
    };
  }
  function gatePanel(g, p) {
    return function (c) {
      c.appendChild(el('div', 'pn', 'Gate ' + g.key));
      c.appendChild(el('div', 'pd', 'A checkpoint: the next phase waits until every line is true.'));
      var ul = el('ul');
      g.checks.forEach(function (ck) {
        var li = el('li', 'st-' + (ck.state === 'open' ? 'next' : ck.state));
        li.appendChild(icon(ck.state === 'open' ? 'next' : ck.state));
        li.appendChild(el('span', null, ck.text));
        ul.appendChild(li);
      });
      c.appendChild(ul);
    };
  }
  function bindPop(node, make) {
    node.setAttribute('data-pop', '1');
    node.addEventListener('click', function (e) { if (dragMoved) return; e.stopPropagation(); openPop(make, node, e); });
  }

  /* ---- build ---- */
  var host = $('phases');
  var subRe = /^(\d+\.\d+)[a-z]$/;
  function topicBtn(it, cls) {
    var b = el('button', cls + ' st-' + it.status);
    b.type = 'button';
    b.appendChild(icon(it.status));
    var s = el('span', 'lbl');
    var n = el('span', 'num', it.id); s.appendChild(n); s.appendChild(document.createTextNode(it.short));
    b.appendChild(s);
    bindPop(b, taskPanel(it));
    return b;
  }
  DATA.phases.forEach(function (p, idx) {
    var sec = el('section', 'phase'); sec.setAttribute('data-phase', p.key);
    var L = el('div', 'stack left'), R = el('div', 'stack right'), C = el('div', 'center');
    // phase box
    var pb = el('button', 'pbox'); pb.type = 'button'; pb.setAttribute('data-pbox', '1');
    pb.appendChild(el('h2', null, p.num + '. ' + p.name));
    pb.appendChild(el('div', 'pshort', p.short + (p.when ? ' · ' + p.when.replace(/^\(|\)$/g, '') : '')));
    if (p.key === 'F') pb.appendChild(el('div', 'pcount', p.counts.future + ' ideas'));
    else pb.appendChild(el('div', 'pcount', p.counts.done + '/' + p.counted + ' done'));
    if (p.key !== 'F') {
      var pbar = el('div', 'pbar'); var a = el('i', 'b-done'); a.style.width = pct(p.counts.done, p.counted) + '%'; var b = el('i', 'b-prog'); b.style.width = pct(p.counts.progress, p.counted) + '%'; pbar.appendChild(a); pbar.appendChild(b); pb.appendChild(pbar);
      if (p.counts.future) pb.appendChild(el('div', 'plater', '+ ' + p.counts.future + ' parked for later'));
    } else pb.appendChild(el('div', 'plater', 'not part of your progress'));
    bindPop(pb, phasePanel(p));
    C.appendChild(pb);
    p.gates.forEach(function (g) {
      var open = g.checks.filter(function (c) { return c.state !== 'future'; });
      var dn = open.filter(function (c) { return c.state === 'done'; }).length;
      var gb = el('button', 'gate' + (open.length && dn === open.length ? ' ok' : '')); gb.type = 'button';
      gb.appendChild(el('span', 'gk', 'Gate ' + g.key));
      gb.appendChild(el('span', 'gn', dn + '/' + open.length));
      gb.setAttribute('data-gate', '1');
      bindPop(gb, gatePanel(g, p));
      C.appendChild(gb);
    });
    // split items: main vs sub (letter suffix)
    var mains = [], subs = {}, orphans = {};
    var mainIds = {};
    p.items.forEach(function (it) { if (!subRe.test(it.id)) mainIds[it.id] = true; });
    p.items.forEach(function (it) {
      var m = subRe.exec(it.id);
      if (!m) { mains.push(it); return; }
      var par = m[1];
      if (mainIds[par]) (subs[par] = subs[par] || []).push(it);
      else (orphans[par] = orphans[par] || []).push(it);
    });
    function sidePanel(items, cap) {
      var s = el('div', 'side'); s.appendChild(el('div', 'cap', cap));
      items.forEach(function (it) {
        var c = el('button', 'chip st-' + it.status); c.type = 'button'; c.appendChild(icon(it.status));
        var lb = el('span', 'lbl'); lb.appendChild(el('span', 'num', it.id + ' ')); lb.appendChild(document.createTextNode(it.short)); c.appendChild(lb);
        bindPop(c, taskPanel(it)); s.appendChild(c);
      });
      return s;
    }
    var n = 0;
    function addRow(stack, it, group, cap, isOrphan) {
      var row = el('div', 'row' + (isOrphan ? ' orphan' : ''));
      if (isOrphan) row.setAttribute('data-orphan', '1');
      if (it) { row.appendChild(topicBtn(it, 'topic')); row.setAttribute('data-topic', '1'); }
      if (group) { if (it) row.appendChild(el('span', 'tie')); row.appendChild(sidePanel(group, cap)); }
      stack.appendChild(row);
    }
    mains.forEach(function (it, i) {
      var stack = (n++ % 2 === 0) ? L : R;
      addRow(stack, it, subs[it.id], 'also in ' + it.id, false);
    });
    Object.keys(orphans).forEach(function (k) {
      var stack = (n++ % 2 === 0) ? L : R;
      addRow(stack, null, orphans[k], 'part of ' + k, true);
    });
    sec.appendChild(L); sec.appendChild(C); sec.appendChild(R);
    host.appendChild(sec);
  });

  /* ---- connectors ---- */
  var canvas = $('canvas'), svg = $('links'), vp = $('viewport');
  var S = 1, TX = 0, TY = 0;
  function isPhone() { return window.matchMedia('(max-width: 759px)').matches; }
  function rel(elm) { var a = elm.getBoundingClientRect(), c = canvas.getBoundingClientRect(); return { l: (a.left - c.left) / S, r: (a.right - c.left) / S, t: (a.top - c.top) / S, b: (a.bottom - c.top) / S, cy: ((a.top + a.bottom) / 2 - c.top) / S }; }
  function draw() {
    svg.textContent = '';
    if (isPhone()) return;
    var h = canvas.offsetHeight; svg.setAttribute('viewBox', '0 0 ' + canvas.offsetWidth + ' ' + h); svg.setAttribute('width', canvas.offsetWidth); svg.setAttribute('height', h);
    var ns = 'http://www.w3.org/2000/svg';
    document.querySelectorAll('.phase').forEach(function (sec) {
      var pb = rel(sec.querySelector('.pbox')), mid = (pb.l + pb.r) / 2;
      sec.querySelectorAll('.row').forEach(function (row) {
        var left = row.parentNode.classList.contains('left');
        var target = row.querySelector('.topic') || row.querySelector('.side');
        var tr = rel(target);
        var x1 = left ? pb.l : pb.r, y1 = pb.t + (pb.b - pb.t) / 2;
        var x2 = left ? tr.r : tr.l, y2 = tr.cy;
        if (row.getAttribute('data-orphan')) { x2 = left ? tr.r : tr.l; }
        var dx = Math.abs(x2 - x1) * 0.55;
        var d = 'M' + x1 + ' ' + y1 + ' C' + (left ? x1 - dx : x1 + dx) + ' ' + y1 + ' ' + (left ? x2 + dx : x2 - dx) + ' ' + y2 + ' ' + x2 + ' ' + y2;
        var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d);
        if (row.getAttribute('data-orphan')) p.setAttribute('class', 'dot');
        svg.appendChild(p);
      });
    });
  }

  /* ---- zoom and pan ---- */
  var dragMoved = false;
  function apply() {
    if (isPhone()) { canvas.style.transform = ''; return; }
    canvas.style.transform = 'translate(' + TX + 'px,' + TY + 'px) scale(' + S + ')';
    $('zlvl').textContent = Math.round(S * 100) + '%';
  }
  function clampPan() {
    var vw = vp.clientWidth, vh = vp.clientHeight, cw = canvas.offsetWidth * S, ch = canvas.offsetHeight * S;
    var minX = Math.min(0, vw - cw - 40), maxX = Math.max(0, vw - cw) > 0 ? (vw - cw) / 2 + 200 : 200;
    if (cw <= vw) { TX = (vw - cw) / 2; } else { TX = Math.max(vw - cw - 80, Math.min(80, TX)); }
    TY = Math.max(Math.min(0, vh - ch - 60), Math.min(40, TY));
  }
  function zoomAt(f, cx, cy) {
    var ns = Math.max(0.2, Math.min(2.2, S * f)); f = ns / S;
    TX = cx - (cx - TX) * f; TY = cy - (cy - TY) * f; S = ns; clampPan(); apply();
  }
  function fit() { S = Math.min(1.4, (vp.clientWidth - 20) / canvas.offsetWidth); TX = (vp.clientWidth - canvas.offsetWidth * S) / 2; TY = 0; clampPan(); apply(); }
  $('zin').addEventListener('click', function () { zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2); });
  $('zout').addEventListener('click', function () { zoomAt(1 / 1.2, vp.clientWidth / 2, vp.clientHeight / 2); });
  $('zfit').addEventListener('click', fit);
  vp.addEventListener('wheel', function (e) {
    if (isPhone()) return; e.preventDefault();
    if (e.ctrlKey || e.metaKey) { var r = vp.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); }
    else { TX -= e.shiftKey ? e.deltaY : e.deltaX; TY -= e.shiftKey ? 0 : e.deltaY; clampPan(); apply(); }
  }, { passive: false });
  var drag = null;
  vp.addEventListener('pointerdown', function (e) {
    if (isPhone() || e.button > 0 || e.target.closest('.zoom')) return;
    drag = { x: e.clientX, y: e.clientY, tx: TX, ty: TY, id: e.pointerId }; dragMoved = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 5) { dragMoved = true; vp.classList.add('drag'); closePop(); }
    if (dragMoved) { TX = drag.tx + dx; TY = drag.ty + dy; clampPan(); apply(); }
  });
  function endDrag() { drag = null; vp.classList.remove('drag'); setTimeout(function () { dragMoved = false; }, 0); }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  function layout() { draw(); if (isPhone()) { canvas.style.transform = ''; } else { clampPan(); apply(); } }
  var first = true;
  var touched = false;
  function refit() { if (!isPhone() && !touched) fit(); draw(); }
  function boot() { refit(); first = false; }
  boot();
  window.addEventListener('resize', function () { if (!isPhone()) { clampPan(); apply(); } draw(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  window.addEventListener('load', refit);
  ['wheel', 'pointerdown'].forEach(function (e) { vp.addEventListener(e, function () { touched = true; }, { passive: true }); });
  window.__roadmap = { draw: draw, fit: fit };
})();
</script>
</body>
</html>
`.replace('__DATA__', () => json);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

console.log('TaskDrop roadmap built: ' + outPath);
console.log(summary.join('\n'));
console.log(`phases ${PHASES.length}, tasks ${allTasks} (${skipped} skipped), counted ${counted} = done ${T.done} + in progress ${T.progress} + next ${T.next}; future scope ${T.future + futureScopeCount} (parked ${T.future} in steps + ${futureScopeCount} in F)`);
