// Builds docs/ULTIMATE_PLAN.html from docs/ULTIMATE_PLAN.md, so the owner can open
// one clickable page in Chrome (tasks open on click, ticks saved in the browser).
// The .md stays the source; run this after every edit to it:
//
//   node scripts/build-plan-html.mjs
//
// The converter only knows the Markdown that file uses: headings, paragraphs, lists
// (one nested level, "- [ ]" ticks), tables, ``` blocks (```say = copyable box,
// ```map = the clickable roadmap, ```mermaid = a diagram drawn by mermaid.js from a CDN,
// ```html = raw HTML passed through as is, for the hand-drawn diagrams),
// "> " quotes, "---", **bold**, `code`, links, and raw HTML lines (<details>, <summary>).
// Task tags: [YOU] [CLAUDE] [BOTH] are tickable tasks; [LATER] is future scope (shown, never
// counted); [CARD] is reference.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs', 'ULTIMATE_PLAN.md');
const dest = join(root, 'docs', 'ULTIMATE_PLAN.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;:])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[Number(n)])}</code>`);
  return s;
}

function listItem(text) {
  const tick = text.match(/^\[( |x)\]\s+(.*)$/);
  if (!tick) return `<li>${inline(text)}</li>`;
  return `<li class="gate-item"><label><input type="checkbox"${tick[1] === 'x' ? ' checked' : ''}> <span>${inline(tick[2])}</span></label></li>`;
}

function convert(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;

    if ((m = line.match(/^```(\w*)\s*$/))) {
      flush();
      const buf = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      const body = esc(buf.join('\n'));
      if (m[1] === 'html') out.push(buf.join('\n'));
      else if (m[1] === 'say') out.push(`<div class="say"><pre>${body}</pre><button type="button" class="copy">Copy</button></div>`);
      // ```map: the page draws a clickable roadmap here; the text map stays as the fallback.
      else if (m[1] === 'map') out.push(`<div id="roadmap" class="roadmap"></div><pre class="block map-text"><code>${body}</code></pre>`);
      // ```mermaid: drawn as a diagram by mermaid.js (GitHub and VS Code draw the same block).
      else if (m[1] === 'mermaid') out.push(`<div class="diagram"><pre class="mermaid">${body}</pre></div>`);
      else out.push(`<pre class="block"><code>${body}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    if (/^\s*</.test(line)) { flush(); out.push(line.trim()); i++; continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const n = m[1].length;
      out.push(`<h${n} id="${slug(m[2])}">${inline(m[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('');
      const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      // Tables with 6+ columns break out of the reading column so they fit without sideways scrolling.
      const wide = cells(rows[0]).length >= 6;
      out.push(`<div class="tablewrap${wide ? ' wide' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    if (line.startsWith('>')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      const text = buf.join(' ');
      out.push(`<blockquote${/GATE/.test(text) ? ' class="gate"' : ''}>${inline(text)}</blockquote>`);
      continue;
    }

    if ((m = line.match(LIST))) {
      flush();
      const ordered = /\d/.test(m[2]);
      const indent = m[1].length;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const mm = l.match(LIST);
        if (mm && mm[1].length === indent && /\d/.test(mm[2]) === ordered) {
          items.push({ text: mm[3], subs: [] });
        } else if (mm && mm[1].length > indent && items.length) {
          items[items.length - 1].subs.push(mm[3]);
        } else if (!mm && l.trim() && /^\s{2,}/.test(l) && items.length) {
          const last = items[items.length - 1];
          if (last.subs.length) last.subs[last.subs.length - 1] += ` ${l.trim()}`;
          else last.text += ` ${l.trim()}`;
        } else {
          break;
        }
        i++;
      }
      const html = items.map((it) => {
        const sub = it.subs.length ? `<ul>${it.subs.map(listItem).join('')}</ul>` : '';
        return listItem(it.text).replace(/<\/li>$/, `${sub}</li>`);
      }).join('');
      out.push(ordered ? `<ol start="${parseInt(m[2], 10)}">${html}</ol>` : `<ul>${html}</ul>`);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

const CSS = `
:root {
  --bg: #f6f8f7; --card: #ffffff; --ink: #15211d; --muted: #5b6b65; --line: #dde4e1; --soft: #eef3f1;
  --jade: #0e8f72; --jade-deep: #0a6f58; --jade-soft: #e2f3ee;
  --blue: #2f5bea; --blue-soft: #e7ecfd;
  --violet: #6b62cf; --violet-soft: #eeedfb;
  --gold: #a8741c; --gold-soft: #fbf1dc;
  --coral: #c4552e; --coral-soft: #fce9e1;
  --code: #eef3f1;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1412; --card: #151f1c; --ink: #e7efec; --muted: #9db0a9; --line: #283632; --soft: #1b2824;
    --jade: #35c9a3; --jade-deep: #35c9a3; --jade-soft: #11302a;
    --blue: #8ea8ff; --blue-soft: #1a2443;
    --violet: #aaa3f0; --violet-soft: #241f45;
    --gold: #e0a85a; --gold-soft: #33290f;
    --coral: #ef9a78; --coral-soft: #3b2018;
    --code: #1b2824;
  }
}
:root[data-theme="dark"] {
  --bg: #0d1412; --card: #151f1c; --ink: #e7efec; --muted: #9db0a9; --line: #283632; --soft: #1b2824;
  --jade: #35c9a3; --jade-deep: #35c9a3; --jade-soft: #11302a;
  --blue: #8ea8ff; --blue-soft: #1a2443;
  --violet: #aaa3f0; --violet-soft: #241f45;
  --gold: #e0a85a; --gold-soft: #33290f;
  --coral: #ef9a78; --coral-soft: #3b2018;
  --code: #1b2824;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 150px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--blue); overflow-wrap: break-word; }
code { background: var(--code); padding: 1px 6px; border-radius: 6px; font-size: .88em; word-break: break-word; }
.bar-top { position: sticky; top: 0; z-index: 10; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.bar-inner { max-width: 960px; margin: 0 auto; padding: 10px 16px; display: grid; gap: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.brand { font-weight: 800; font-size: 1.05rem; letter-spacing: -.01em; }
.brand .dot { color: var(--jade); }
.progress { flex: 1 1 220px; min-width: 180px; }
.progress .lbl { font-size: .82rem; color: var(--muted); }
.track { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
.track i { display: block; height: 100%; width: 0; background: var(--jade); transition: width .3s; }
.btn { border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 10px; padding: 6px 12px; font: inherit; font-size: .88rem; cursor: pointer; }
.btn:hover { border-color: var(--jade); }
.btn.on { background: var(--jade); border-color: var(--jade); color: #fff; }
.next { background: var(--jade-soft); border: 1px solid var(--jade); color: var(--jade-deep); border-radius: 10px; padding: 6px 12px; font-size: .9rem; cursor: pointer; text-align: left; font: inherit; }
.next b { font-weight: 700; }
.nav { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.nav a { white-space: nowrap; text-decoration: none; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 99px; padding: 3px 10px; font-size: .8rem; }
.nav a span { color: var(--muted); margin-left: 4px; }
main { max-width: 960px; margin: 0 auto; padding: 8px 16px 80px; }
h1 { font-size: 1.9rem; letter-spacing: -.02em; margin: 24px 0 8px; }
h2 { font-size: 1.35rem; margin: 40px 0 10px; padding-top: 12px; border-top: 2px solid var(--line); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
h2 .count { font-size: .8rem; font-weight: 600; color: var(--jade-deep); background: var(--jade-soft); padding: 2px 10px; border-radius: 99px; }
h2.paper { border-top-color: var(--gold); }
h3 { font-size: 1.05rem; margin: 18px 0 6px; }
hr { display: none; }
.tablewrap { overflow-x: auto; margin: 10px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.tablewrap.wide { overflow-x: visible; width: min(96vw, 1760px); margin-left: 50%; transform: translateX(-50%); }
.tablewrap.wide table { font-size: .86rem; }
.tablewrap.wide td:nth-child(3) { white-space: nowrap; }
@media (max-width: 1000px) { .tablewrap.wide { overflow-x: auto; width: auto; margin-left: 0; transform: none; } .tablewrap.wide table { min-width: 1000px; } }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--soft); font-size: .8rem; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
pre { margin: 0; white-space: pre; overflow-x: auto; }
pre.block { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: .8rem; line-height: 1.45; margin: 10px 0; }
.say { position: relative; background: var(--violet-soft); border: 1px solid var(--violet); border-radius: 12px; padding: 12px 74px 12px 14px; margin: 10px 0; }
.say::before { content: "SAY TO CLAUDE"; display: block; font-size: .68rem; font-weight: 800; letter-spacing: .08em; color: var(--violet); margin-bottom: 4px; }
.say pre { white-space: pre-wrap; word-break: break-word; font: 600 .95rem/1.5 ui-monospace, Consolas, monospace; }
.say .copy { position: absolute; top: 10px; right: 10px; border: 1px solid var(--violet); background: var(--card); color: var(--violet); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: .8rem; cursor: pointer; }
blockquote { margin: 18px 0 6px; padding: 10px 14px; border-radius: 12px; background: var(--soft); border-left: 4px solid var(--muted); }
blockquote.gate { background: var(--coral-soft); border-left-color: var(--coral); color: var(--ink); }
ul, ol { padding-left: 24px; }
li { margin: 4px 0; }
li.gate-item { list-style: none; margin-left: -24px; }
li.gate-item label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
li.gate-item label:hover { background: var(--soft); }
li.gate-item input { width: 18px; height: 18px; margin-top: 4px; accent-color: var(--coral); flex: none; }
details { background: var(--card); border: 1px solid var(--line); border-radius: 14px; margin: 10px 0; overflow: hidden; }
details.done { opacity: .62; }
details[open] { box-shadow: 0 4px 18px rgba(0,0,0,.06); }
summary { list-style: none; cursor: pointer; padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--soft); }
summary .ttl { flex: 1; font-weight: 600; }
summary .ttl b { color: var(--muted); margin-right: 4px; }
summary .ttl small { display: block; font-weight: 400; color: var(--muted); font-size: .84rem; }
details.done summary .ttl { text-decoration: line-through; }
summary .chev { color: var(--muted); transition: transform .2s; margin-top: 2px; }
details[open] summary .chev { transform: rotate(90deg); }
.tick { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--muted); background: var(--card); cursor: pointer; display: grid; place-items: center; color: #fff; font-size: 15px; font-weight: 900; padding: 0; margin-top: 1px; }
.tick[aria-checked="true"] { background: var(--jade); border-color: var(--jade); }
.badge { flex: none; font-size: .7rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 3px 8px; border-radius: 99px; margin-top: 3px; }
.badge.you { background: var(--jade-soft); color: var(--jade-deep); }
.badge.claude { background: var(--violet-soft); color: var(--violet); }
.badge.both { background: var(--blue-soft); color: var(--blue); }
.badge.card { background: var(--gold-soft); color: var(--gold); }
.body { padding: 4px 18px 16px; border-top: 1px solid var(--line); }
.hidden { display: none !important; }
.js .map-text { display: none; }
.roadmap { display: grid; gap: 12px; margin: 12px 0; }
.rm-steps { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.rm-later { border: 2px dashed var(--line); background: var(--soft); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.rm-later .rm-num { background: var(--muted); }
.rm-later .rm-chips { flex-direction: row; flex-wrap: wrap; }
.chip .dot.later { background: var(--muted); }
.badge.later { background: var(--soft); color: var(--muted); border: 1px dashed var(--muted); }
details.role-later { border-style: dashed; background: var(--soft); }
h2.future { border-top-color: var(--muted); border-top-style: dashed; }
/* Hand-drawn diagrams (the html code blocks) */
.fig { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 14px 0; }
.fig-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-weight: 800; margin-bottom: 4px; }
.fig-sub { color: var(--muted); font-size: .86rem; margin-bottom: 12px; }
.pill { display: inline-block; font-size: .72rem; font-weight: 800; letter-spacing: .06em; padding: 3px 10px; border-radius: 99px; text-transform: uppercase; }
.pill.stg { background: var(--gold-soft); color: var(--gold); border: 1px solid var(--gold); }
.pill.prd { background: var(--jade-soft); color: var(--jade-deep); border: 1px solid var(--jade); }
.pill.mut { background: var(--soft); color: var(--muted); border: 1px solid var(--line); }
.am-band { border: 2px solid var(--line); border-radius: 14px; padding: 12px; margin: 10px 0; position: relative; }
.am-band.g1 { border-color: var(--blue); }
.am-band.g2 { border-color: var(--coral); }
.am-band.g3 { border-color: var(--violet); }
.am-band.gh { border-color: var(--muted); }
.am-owner { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
.am-ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 900; color: #fff; flex: none; }
.g1 .am-ic { background: var(--blue); } .g2 .am-ic { background: var(--coral); } .g3 .am-ic { background: var(--violet); } .gh .am-ic { background: var(--muted); }
.am-owner b { display: block; word-break: break-all; }
.am-owner small { color: var(--muted); }
.am-cards { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); padding-left: 14px; border-left: 3px solid var(--line); }
.g1 .am-cards { border-left-color: var(--blue); } .g2 .am-cards { border-left-color: var(--coral); } .g3 .am-cards { border-left-color: var(--violet); }
.am-card { position: relative; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; font-size: .84rem; }
.am-card::before { content: ""; position: absolute; left: -17px; top: 18px; width: 15px; border-top: 3px solid var(--line); }
.g1 .am-card::before { border-color: var(--blue); } .g2 .am-card::before { border-color: var(--coral); } .g3 .am-card::before { border-color: var(--violet); }
.am-tool { font-weight: 800; font-size: .95rem; display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
.am-tool span { font-weight: 600; font-size: .7rem; color: var(--muted); }
.am-card dl { margin: 6px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.am-card dt { color: var(--muted); font-size: .76rem; }
.am-card dd { margin: 0; word-break: break-word; }
.am-card dd code { font-size: .78rem; padding: 0 4px; }
.am-card.new { border-style: dashed; border-color: var(--jade); }
.am-card.shared { border-style: dashed; }
.logins { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 8px; }
.logins .am-owner { margin: 0; border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: var(--bg); }
.am-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: .8rem; color: var(--muted); margin-top: 8px; }
.layers { display: grid; gap: 8px; }
.layer { display: grid; grid-template-columns: 54px 1fr auto; gap: 10px; align-items: center; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--bg); }
.layer .ln { font-weight: 900; font-size: 1.1rem; color: var(--jade-deep); }
.layer .lt b { display: block; }
.layer .lt small { color: var(--muted); }
.st { font-size: .72rem; font-weight: 800; padding: 3px 9px; border-radius: 99px; white-space: nowrap; }
.st.ok { background: var(--jade-soft); color: var(--jade-deep); } .st.part { background: var(--gold-soft); color: var(--gold); } .st.no { background: var(--coral-soft); color: var(--coral); }
.tl { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.tl-col { border: 1px solid var(--line); border-top: 5px solid var(--jade); border-radius: 12px; padding: 10px 12px; background: var(--bg); font-size: .84rem; }
.tl-col.c2 { border-top-color: var(--blue); } .tl-col.c3 { border-top-color: var(--coral); } .tl-col.c4 { border-top-color: var(--violet); } .tl-col.c5 { border-top-color: var(--gold); }
.tl-col b { display: block; font-size: .95rem; } .tl-col small { color: var(--muted); display: block; margin-bottom: 6px; }
.tl-col ul { margin: 0; padding-left: 18px; } .tl-col li { margin: 2px 0; }
.flowline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: .84rem; }
.flowline .fb { border: 1px solid var(--line); background: var(--bg); border-radius: 10px; padding: 6px 10px; }
.flowline .fa { color: var(--muted); }
@media (max-width: 560px) { .layer { grid-template-columns: 40px 1fr; } .layer .st { grid-column: 2; justify-self: start; } .am-cards { padding-left: 10px; } }
.diagram { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin: 12px 0; overflow-x: auto; }
.diagram pre.mermaid { margin: 0; font-size: .8rem; white-space: pre; }
.diagram svg { max-width: 100%; height: auto; }
.diagram .note { font-size: .8rem; color: var(--muted); margin-top: 6px; }
.rm-step, .rm-paper { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.rm-paper { border: 2px dashed var(--gold); background: var(--gold-soft); }
.rm-head { display: flex; gap: 8px; align-items: center; }
.rm-num { width: 28px; height: 28px; flex: none; border-radius: 50%; background: var(--jade); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: .9rem; }
.rm-paper .rm-num { background: var(--gold); }
.rm-title { font-weight: 800; line-height: 1.2; }
.rm-when { font-size: .78rem; color: var(--muted); }
.rm-bar { height: 6px; background: var(--line); border-radius: 99px; overflow: hidden; }
.rm-bar i { display: block; height: 100%; width: 0; background: var(--jade); transition: width .3s; }
.rm-paper .rm-bar i { background: var(--gold); }
.rm-chips { display: flex; flex-direction: column; gap: 4px; }
.rm-paper .rm-chips { flex-direction: row; flex-wrap: wrap; }
.chip { display: flex; gap: 6px; align-items: center; text-align: left; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 8px; padding: 4px 8px; font: inherit; font-size: .8rem; cursor: pointer; }
.chip:hover { border-color: var(--jade); }
.chip .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.chip .dot.you { background: var(--jade); }
.chip .dot.claude { background: var(--violet); }
.chip .dot.both { background: var(--blue); }
.chip.done { color: var(--muted); text-decoration: line-through; }
.chip.done .dot { background: var(--muted); }
.rm-gate { margin-top: auto; border: 0; background: var(--coral-soft); color: var(--coral); border-radius: 8px; padding: 5px 8px; font: inherit; font-size: .76rem; font-weight: 700; cursor: pointer; text-align: left; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: .82rem; color: var(--muted); }
.legend span { display: inline-flex; gap: 6px; align-items: center; }
@media (max-width: 900px) { .rm-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 700px) { .rm-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .rm-steps { grid-template-columns: 1fr; } }
footer { margin-top: 48px; color: var(--muted); font-size: .85rem; }
@media (max-width: 640px) {
  h1 { font-size: 1.5rem; }
  summary { gap: 8px; padding: 12px 10px; }
  .body { padding: 4px 12px 14px; }
  .say { padding-right: 14px; padding-top: 40px; }
  .say::before { position: absolute; top: 14px; left: 14px; }
}
@media print {
  .bar-top { display: none; }
  details { break-inside: avoid; }
}
`;

const JS = `
(function () {
  var KEY = 'taskdrop-ultimate-plan-v3';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { state = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  try { var t = localStorage.getItem(KEY + ':theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}

  var main = document.querySelector('main');
  var labels = { YOU: 'You', CLAUDE: 'Claude', BOTH: 'Both', CARD: 'Card', LATER: 'Later' };
  var tasks = [];
  var later = [];

  // Turn each <details> with a [ROLE] tag into a task card.
  Array.prototype.forEach.call(main.querySelectorAll('details'), function (d) {
    var s = d.querySelector('summary');
    var m = s.innerHTML.match(/^\\s*\\[(YOU|CLAUDE|BOTH|CARD|LATER)\\]\\s*/);
    var role = m ? m[1] : 'CARD';
    var rest = m ? s.innerHTML.slice(m[0].length) : s.innerHTML;
    d.classList.add('role-' + role.toLowerCase());
    var body = document.createElement('div');
    body.className = 'body';
    while (s.nextSibling) body.appendChild(s.nextSibling);
    d.appendChild(body);
    s.innerHTML = '';
    if (role === 'LATER') later.push(d);
    if (role !== 'CARD' && role !== 'LATER') {
      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'tick';
      tick.setAttribute('role', 'checkbox');
      tick.setAttribute('aria-label', 'Mark as done');
      tick.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state[d.id] = !state[d.id];
        save();
        render();
      });
      s.appendChild(tick);
      tasks.push(d);
    }
    var badge = document.createElement('span');
    badge.className = 'badge ' + role.toLowerCase();
    badge.textContent = labels[role];
    s.appendChild(badge);
    var ttl = document.createElement('span');
    ttl.className = 'ttl';
    ttl.innerHTML = rest;
    s.appendChild(ttl);
    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '\\u25B8';
    s.appendChild(chev);
  });

  // Gate ticks.
  Array.prototype.forEach.call(main.querySelectorAll('li.gate-item input'), function (cb, n) {
    var id = 'gate:' + n + ':' + cb.parentNode.textContent.trim().slice(0, 40);
    cb.checked = !!state[id] || cb.checked;
    cb.addEventListener('change', function () { state[id] = cb.checked; save(); });
  });

  // Sections: each h2 owns the tasks after it.
  var sections = [];
  var current = null;
  Array.prototype.forEach.call(main.children, function (el) {
    if (el.tagName === 'H2') {
      current = { h: el, title: el.textContent, tasks: [], later: [], gate: null };
      sections.push(current);
      if (/START NOW/.test(el.textContent)) el.classList.add('paper');
      if (/FUTURE SCOPE/.test(el.textContent)) el.classList.add('future');
    } else if (current && el.tagName === 'DETAILS' && tasks.indexOf(el) >= 0) {
      current.tasks.push(el);
    } else if (current && el.tagName === 'DETAILS' && later.indexOf(el) >= 0) {
      current.later.push(el);
    } else if (current && el.matches('blockquote.gate')) {
      current.gate = el;
    }
  });

  function openTask(d) {
    d.classList.remove('hidden');
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The clickable roadmap, drawn from the sections and tasks above (so it never drifts).
  var chips = [];
  var rmBars = [];
  var roadmap = document.getElementById('roadmap');
  if (roadmap) {
    document.documentElement.classList.add('js');
    var stepsRow = document.createElement('div');
    stepsRow.className = 'rm-steps';
    var paperCard = null;
    var laterCard = null;
    sections.forEach(function (sec) {
      if (sec.later.length && !sec.tasks.length) {
        laterCard = document.createElement('div');
        laterCard.className = 'rm-later';
        laterCard.innerHTML = '<div class="rm-head"><span class="rm-num">F</span><div><div class="rm-title">Future scope</div><div class="rm-when">Not part of your progress. Start one only when you say so.</div></div></div>';
        var ll = document.createElement('div');
        ll.className = 'rm-chips';
        sec.later.forEach(function (d) {
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.innerHTML = '<span class="dot later"></span><span></span>';
          chip.lastChild.textContent = d.getAttribute('data-short') || d.querySelector('.ttl').textContent;
          chip.addEventListener('click', function () { openTask(d); });
          ll.appendChild(chip);
        });
        laterCard.appendChild(ll);
        return;
      }
      if (!sec.tasks.length) return;
      var paper = /START NOW/.test(sec.title);
      var m = sec.title.match(/^STEP (\\d+):\\s*([^(]+)(?:\\(([^)]*)\\))?/);
      if (!paper && !m) return;
      var card = document.createElement('div');
      card.className = paper ? 'rm-paper' : 'rm-step';
      var head = document.createElement('div');
      head.className = 'rm-head';
      head.innerHTML = '<span class="rm-num">' + (paper ? 'S' : m[1]) + '</span><div><div class="rm-title"></div><div class="rm-when"></div></div>';
      head.querySelector('.rm-title').textContent = paper ? 'Start now: the slow track' : m[2].split(',')[0].trim();
      head.querySelector('.rm-when').textContent = paper ? 'Start all of these in week 1. They wait on Google, banks, lawyers and Razorpay, so they run beside Steps 1 to 4. All must be done before Step 5.' : (m[3] || '');
      card.appendChild(head);
      var bar = document.createElement('div');
      bar.className = 'rm-bar';
      bar.innerHTML = '<i></i>';
      card.appendChild(bar);
      rmBars.push({ bar: bar.firstChild, sec: sec });
      var list = document.createElement('div');
      list.className = 'rm-chips';
      sec.tasks.forEach(function (d) {
        var role = d.classList.contains('role-you') ? 'you' : d.classList.contains('role-claude') ? 'claude' : 'both';
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.innerHTML = '<span class="dot ' + role + '"></span><span></span>';
        chip.lastChild.textContent = d.getAttribute('data-short') || d.querySelector('.ttl').textContent;
        chip.title = d.querySelector('.ttl').textContent.trim();
        chip.addEventListener('click', function () { openTask(d); });
        chips.push({ el: chip, d: d });
        list.appendChild(chip);
      });
      card.appendChild(list);
      if (sec.gate) {
        var g = document.createElement('button');
        g.type = 'button';
        g.className = 'rm-gate';
        var gm = sec.gate.textContent.match(/GATE \\d+/);
        g.textContent = (gm ? gm[0].replace('GATE', 'Gate') : 'Gate') + ': see the checklist';
        g.addEventListener('click', function () { sec.gate.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        card.appendChild(g);
      }
      if (paper) paperCard = card; else stepsRow.appendChild(card);
    });
    if (paperCard) roadmap.appendChild(paperCard);
    roadmap.appendChild(stepsRow);
    if (laterCard) roadmap.appendChild(laterCard);
    var legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = '<span><span style="width:8px;height:8px;border-radius:50%;background:var(--jade)"></span>You do it</span>' +
      '<span><span style="width:8px;height:8px;border-radius:50%;background:var(--violet)"></span>Claude does it</span>' +
      '<span><span style="width:8px;height:8px;border-radius:50%;background:var(--blue)"></span>Both</span>' +
      '<span>Click any task to open its steps</span>';
    roadmap.appendChild(legend);
  }

  var nav = document.getElementById('nav');
  sections.forEach(function (sec) {
    var a = document.createElement('a');
    a.href = '#' + sec.h.id;
    var name = (sec.h.getAttribute('data-nav') || sec.h.textContent.split(/[:(]/)[0]).trim();
    name = name.charAt(0) + name.slice(1).toLowerCase();
    a.textContent = name;
    if (sec.tasks.length) {
      var c = document.createElement('span');
      a.appendChild(c);
      sec.navCount = c;
      var hc = document.createElement('span');
      hc.className = 'count';
      sec.h.appendChild(hc);
      sec.headCount = hc;
    }
    nav.appendChild(a);
  });

  var nextBtn = document.getElementById('next');
  function render() {
    var done = 0;
    var next = null;
    tasks.forEach(function (d) {
      var on = !!state[d.id];
      d.classList.toggle('done', on);
      var t = d.querySelector('.tick');
      t.setAttribute('aria-checked', on ? 'true' : 'false');
      t.textContent = on ? '\\u2713' : '';
      // The slow track (ids tS-*) runs beside the steps, so "Next" follows the steps only.
      if (on) done++; else if (!next && d.id.indexOf('tS-') !== 0) next = d;
    });
    sections.forEach(function (sec) {
      if (!sec.tasks.length) return;
      var n = sec.tasks.filter(function (d) { return state[d.id]; }).length;
      sec.navCount.textContent = n + '/' + sec.tasks.length;
      sec.headCount.textContent = n + ' of ' + sec.tasks.length + ' done';
    });
    chips.forEach(function (c) { c.el.classList.toggle('done', !!state[c.d.id]); });
    rmBars.forEach(function (r) {
      var n = r.sec.tasks.filter(function (d) { return state[d.id]; }).length;
      r.bar.style.width = Math.round(n * 100 / r.sec.tasks.length) + '%';
    });
    document.getElementById('count').textContent = done + ' of ' + tasks.length + ' tasks done';
    document.getElementById('fill').style.width = (tasks.length ? Math.round(done * 100 / tasks.length) : 0) + '%';
    if (next) {
      nextBtn.classList.remove('hidden');
      nextBtn.innerHTML = '<b>Next:</b> ' + next.querySelector('.ttl').innerHTML.replace(/<small>.*<\\/small>/, '');
      nextBtn.onclick = function () { openTask(next); };
    } else {
      nextBtn.classList.add('hidden');
    }
  }
  render();

  // Filters.
  var filters = document.querySelectorAll('[data-filter]');
  Array.prototype.forEach.call(filters, function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-filter');
      Array.prototype.forEach.call(filters, function (x) { x.classList.toggle('on', x === b); });
      tasks.forEach(function (d) {
        var show = f === 'all' || d.classList.contains('role-' + f) || d.classList.contains('role-both');
        if (f !== 'all' && d.classList.contains('role-later')) show = false;
        d.classList.toggle('hidden', !show);
      });
    });
  });

  document.getElementById('expand').addEventListener('click', function () {
    var open = this.getAttribute('data-open') !== '1';
    Array.prototype.forEach.call(main.querySelectorAll('details'), function (d) { d.open = open; });
    this.setAttribute('data-open', open ? '1' : '0');
    this.textContent = open ? 'Close all' : 'Open all';
  });

  // Diagrams: keep each source so a theme switch can redraw it.
  var diagrams = Array.prototype.map.call(main.querySelectorAll('pre.mermaid'), function (pre) {
    return { pre: pre, src: pre.textContent };
  });
  function isDark() {
    var cur = document.documentElement.getAttribute('data-theme');
    return cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function drawDiagrams() {
    if (!diagrams.length) return;
    if (!window.mermaid) {
      diagrams.forEach(function (d) {
        if (d.pre.nextSibling) return;
        var n = document.createElement('div');
        n.className = 'note';
        n.textContent = 'This diagram needs an internet connection to be drawn. The text above is the same diagram.';
        d.pre.parentNode.appendChild(n);
      });
      return;
    }
    diagrams.forEach(function (d) {
      d.pre.removeAttribute('data-processed');
      d.pre.textContent = d.src;
    });
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default', flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true } });
    window.mermaid.run({ nodes: diagrams.map(function (d) { return d.pre; }) }).catch(function () {});
  }
  drawDiagrams();

  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var nextTheme = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', nextTheme);
    try { localStorage.setItem(KEY + ':theme', nextTheme); } catch (e) {}
    drawDiagrams();
  });

  // Copy buttons on the "say to Claude" boxes.
  Array.prototype.forEach.call(main.querySelectorAll('.say .copy'), function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.parentNode.querySelector('pre').textContent;
      function ok() { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) {}
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
      else fallback();
    });
  });

  // Opening a link to a task (#t1-2) opens that task.
  function openHash() {
    var el = location.hash && document.getElementById(location.hash.slice(1));
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
  window.addEventListener('hashchange', openHash);
  openHash();
})();
`;

const md = readFileSync(src, 'utf8');
const content = convert(md);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TaskDrop ultimate plan</title>
<style>${CSS}</style>
</head>
<body>
<div class="bar-top">
  <div class="bar-inner">
    <div class="row">
      <span class="brand">taskdrop<span class="dot">.</span> ultimate plan</span>
      <div class="progress"><div class="lbl" id="count"></div><div class="track"><i id="fill"></i></div></div>
      <div class="row" style="gap:6px">
        <button class="btn on" type="button" data-filter="all">All</button>
        <button class="btn" type="button" data-filter="you">Mine</button>
        <button class="btn" type="button" data-filter="claude">Claude's</button>
        <button class="btn" type="button" id="expand">Open all</button>
        <button class="btn" type="button" id="theme" aria-label="Switch dark or light">&#9680;</button>
      </div>
    </div>
    <button class="next hidden" type="button" id="next"></button>
    <nav class="nav" id="nav" aria-label="Sections"></nav>
  </div>
</div>
<main>
${content}
<footer>Made from <code>docs/ULTIMATE_PLAN.md</code> by <code>node scripts/build-plan-html.mjs</code>. Your ticks are saved in this browser only. Planning aid, not legal, tax or investment advice.</footer>
</main>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>${JS}</script>
</body>
</html>
`;

writeFileSync(dest, html);
console.log(`Wrote ${dest} (${Math.round(html.length / 1024)} KB)`);
