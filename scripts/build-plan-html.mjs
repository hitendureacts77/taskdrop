// Builds docs/ULTIMATE_PLAN.html from docs/ULTIMATE_PLAN.md, so the owner can open
// one clickable page in Chrome (tasks open on click, ticks saved in the browser).
// The .md stays the source; run this after every edit to it:
//
//   node scripts/build-plan-html.mjs
//
// The converter only knows the Markdown that file uses: headings, paragraphs, lists
// (one nested level, "- [ ]" ticks), tables, ``` blocks (```say = copyable box,
// ```map = the clickable roadmap, ```steps = the numbered setup guide, ```mermaid = a
// diagram drawn by mermaid.js from a CDN, ```html = raw HTML passed through as is),
// "> " quotes, "---", **bold**, `code`, links (also #anchors), and raw HTML lines.
// "## Title {open}" keeps a whole section on screen; every other section shows its
// first paragraph, its tasks, cards and gates, and folds the rest into titled drawers.
// Task tags: [YOU] [CLAUDE] [BOTH] are tickable tasks; [LATER] is future scope (shown, never
// counted); [CARD] is reference. A task whose summary says "Done" starts ticked.
//
// ```steps format: "# Part title | one line under it", then one line per step:
// "5.2 | Step title | One or two sentences" ("-" instead of a task number for a step
// that has no task card).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs', 'ULTIMATE_PLAN.md');
const dest = join(root, 'docs', 'ULTIMATE_PLAN.html');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const taskId = (n) => `t${n.replace('.', '-')}`;

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((#[\w-]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|[\w./-]+\.(?:html|md))\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
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

// The numbered setup guide (```steps).
function guide(lines) {
  let html = '<div class="guide">';
  let open = false;
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('# ')) {
      if (open) html += '</ol></section>';
      const [title, sub = ''] = line.slice(2).split(' | ');
      html += `<section class="g-part"><div class="g-head"><div class="g-title">${inline(title)}</div>${sub ? `<div class="g-sub">${inline(sub)}</div>` : ''}</div><ol class="g-steps">`;
      open = true;
      continue;
    }
    const [task, title, detail = ''] = line.split(' | ').map((x) => x.trim());
    n++;
    const id = task && task !== '-' ? taskId(task) : '';
    const num = id ? `<a class="g-task" href="#${id}">${esc(task)}</a>` : '';
    html += `<li class="g-step"${id ? ` data-task="${id}"` : ''}><span class="g-num">${n}</span><div class="g-main"><div class="g-line">${num}<span class="g-name">${inline(title)}</span><span class="g-meta"></span></div><div class="g-detail">${inline(detail)}</div></div></li>`;
  }
  if (open) html += '</ol></section>';
  return `${html}</div>`;
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
      else if (m[1] === 'steps') out.push(guide(buf));
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
      let title = m[2];
      const keepOpen = /\s*\{open\}\s*$/.test(title);
      title = title.replace(/\s*\{open\}\s*$/, '');
      out.push(`<h${n} id="${slug(title)}"${keepOpen ? ' class="open-sec"' : ''}>${inline(title)}</h${n}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const headCells = cells(rows[0]);
      // A table whose headers carry "(staging)" and "(production)" is drawn as two colour-coded
      // sides, row by row: staging on the left, production on the right.
      const stgCols = headCells.map((c, n) => (/\(staging\)/i.test(c) ? n : -1)).filter((n) => n >= 0);
      const prdCols = headCells.map((c, n) => (/\(production\)/i.test(c) ? n : -1)).filter((n) => n >= 0);
      if (stgCols.length && prdCols.length) {
        const label = (c) => c.replace(/\s*\((staging|production)\)/i, '');
        const sharedCols = headCells.map((_, n) => n).filter((n) => !stgCols.includes(n) && !prdCols.includes(n));
        const side = (cs, cls) => `<div class="cmp-side ${cls}"><dl>${cs.map((n) => `<dt>${inline(label(headCells[n]))}</dt><dd>${cs.vals[n] ? inline(cs.vals[n]) : '<span class="none">none</span>'}</dd>`).join('')}</dl></div>`;
        const cardsHtml = rows.slice(2).map((r) => {
          const v = cells(r);
          const stg = Object.assign([...stgCols], { vals: v });
          const prd = Object.assign([...prdCols], { vals: v });
          const name = v[sharedCols[0]] || '';
          const extra = sharedCols.slice(1).map((n) => (v[n] ? `<span class="cmp-x"><i>${inline(headCells[n])}</i> ${inline(v[n])}</span>` : '')).join('');
          return `<div class="cmp-row"><div class="cmp-tool"><span class="cmp-name">${inline(name)}</span>${extra}</div>${side(stg, 'stg')}${side(prd, 'prd')}</div>`;
        }).join('');
        out.push(`<div class="cmp"><div class="cmp-head"><div class="cmp-h stg"><b>STAGING</b> the test copy: fake money, fake data, testers only</div><div class="cmp-h prd"><b>PRODUCTION</b> the real copy: real money, real customers</div></div>${cardsHtml}</div>`);
        continue;
      }
      const head = headCells.map((c) => `<th>${inline(c)}</th>`).join('');
      const body = rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      // Tables with 6+ columns keep a minimum width and scroll sideways only on narrow screens.
      const wide = headCells.length >= 6;
      // Two-sided tables ("Staging ... | Production ...") get colour-coded columns.
      const sp = headCells.length >= 3 && /staging/i.test(headCells[1]) && /production/i.test(headCells[2]);
      out.push(`<div class="tablewrap${wide ? ' wide' : ''}${sp ? ' sp' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    if (line.startsWith('>')) {
      flush();
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      const text = buf.join(' ');
      const gate = text.match(/GATE (\w+)/);
      out.push(gate ? `<blockquote class="gate" id="gate-${gate[1].toLowerCase()}">${inline(text)}</blockquote>` : `<blockquote>${inline(text)}</blockquote>`);
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
  --side-w: 272px;
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
html { scroll-padding-top: calc(var(--bar-h, 110px) + 12px); }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
a { color: var(--blue); overflow-wrap: break-word; }
code { background: var(--code); padding: 1px 6px; border-radius: 6px; font-size: .88em; word-break: break-word; }

/* Top bar */
.bar-top { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.bar-inner { padding: 10px clamp(12px, 2vw, 32px); display: grid; gap: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.row.top { justify-content: space-between; }
.brand { font-weight: 800; font-size: 1.05rem; letter-spacing: -.01em; white-space: nowrap; }
.brand .dot { color: var(--jade); }
.progress { flex: 1 1 200px; min-width: 160px; max-width: 420px; }
.progress .lbl { font-size: .8rem; color: var(--muted); }
.track { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
.track i { display: block; height: 100%; width: 0; background: var(--jade); transition: width .3s; }
.btn { border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 10px; padding: 6px 12px; font: inherit; font-size: .86rem; cursor: pointer; }
.btn:hover { border-color: var(--jade); }
.btn.on { background: var(--jade); border-color: var(--jade); color: #fff; }
#menu { display: none; }
.search { position: relative; flex: 1 1 180px; max-width: 300px; }
.search input { width: 100%; border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 10px; padding: 6px 12px; font: inherit; font-size: .88rem; }
.search input:focus { outline: 2px solid var(--jade); outline-offset: 0; border-color: var(--jade); }
.qinfo { font-size: .8rem; color: var(--muted); }
.next { background: var(--jade-soft); border: 1px solid var(--jade); color: var(--jade-deep); border-radius: 10px; padding: 6px 12px; cursor: pointer; text-align: left; font: inherit; font-size: .9rem; justify-self: start; max-width: 100%; }
.next b { font-weight: 700; }
.next { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Side menu */
.layout { display: grid; grid-template-columns: var(--side-w) minmax(0, 1fr); }
.side { position: sticky; top: var(--bar-h, 110px); align-self: start; height: calc(100vh - var(--bar-h, 110px)); overflow-y: auto; border-right: 1px solid var(--line); padding: 14px 10px 60px; scrollbar-width: thin; }
.side h5 { margin: 16px 8px 6px; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.side h5:first-child { margin-top: 0; }
.side a { display: flex; gap: 8px; align-items: center; text-decoration: none; color: var(--ink); padding: 5px 8px; border-radius: 8px; font-size: .88rem; line-height: 1.3; }
.side a:hover { background: var(--soft); }
.side a.on { background: var(--jade-soft); color: var(--jade-deep); font-weight: 700; }
.side .n { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: .72rem; font-weight: 800; background: var(--soft); color: var(--muted); }
.side a.on .n { background: var(--jade); color: #fff; }
.side .lbl { flex: 1; }
.side .c { flex: none; font-size: .7rem; color: var(--muted); }
.side .mini { display: block; height: 3px; background: var(--line); border-radius: 99px; margin-top: 3px; overflow: hidden; }
.side .mini i { display: block; height: 100%; background: var(--jade); }
.scrim { display: none; }
main { min-width: 0; padding: 8px clamp(16px, 3vw, 48px) 80px; }
main p, main > ul, main > ol, .sec > ul, .sec > ol, .dr-body > p, .dr-body > ul, .dr-body > ol, .body > p, .body > ul, .body > ol { max-width: 82ch; }
@media (max-width: 1000px) {
  .layout { grid-template-columns: 1fr; }
  #menu { display: inline-block; }
  .side { position: fixed; left: 0; top: var(--bar-h, 110px); bottom: 0; height: auto; width: min(320px, 86vw); background: var(--bg); z-index: 25; transform: translateX(-105%); transition: transform .2s; box-shadow: 0 10px 30px rgba(0,0,0,.18); }
  body.nav-open .side { transform: none; }
  body.nav-open .scrim { display: block; position: fixed; inset: 0; z-index: 24; background: rgba(0,0,0,.25); }
}

/* Headings and sections */
h1 { font-size: 1.8rem; letter-spacing: -.02em; margin: 20px 0 6px; }
.intro p, .intro ul { max-width: 82ch; }
.sec { margin: 0 0 8px; padding-top: 4px; }
h2 { font-size: 1.4rem; margin: 36px 0 8px; padding-top: 14px; border-top: 2px solid var(--line); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; letter-spacing: -.01em; }
h2 .count { font-size: .78rem; font-weight: 600; color: var(--jade-deep); background: var(--jade-soft); padding: 2px 10px; border-radius: 99px; }
h2.paper { border-top-color: var(--gold); }
h2.future { border-top-color: var(--muted); border-top-style: dashed; }
.sec-bar { height: 4px; background: var(--line); border-radius: 99px; overflow: hidden; margin: -2px 0 12px; max-width: 420px; }
.sec-bar i { display: block; height: 100%; background: var(--jade); width: 0; transition: width .3s; }
.lede { font-size: 1.02rem; }
h3 { font-size: 1.08rem; margin: 22px 0 6px; }
h3.subhead { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; margin: 22px 0 4px; }
hr { display: none; }

/* Drawers: background folded away, with a clear title */
details.drawer { background: transparent; border: 1px dashed var(--line); border-radius: 12px; margin: 8px 0; box-shadow: none; }
details.drawer > summary { padding: 9px 14px; gap: 10px; align-items: center; color: var(--ink); }
details.drawer > summary .dr-ic { flex: none; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; background: var(--soft); color: var(--muted); font-size: .8rem; font-weight: 800; }
details.drawer > summary .dr-ttl { flex: 1; font-weight: 600; font-size: .95rem; }
details.drawer > summary .dr-meta { flex: none; font-size: .74rem; color: var(--muted); }
details.drawer[open] { border-style: solid; background: var(--card); }
details.drawer[open] > summary { border-bottom: 1px solid var(--line); border-radius: 12px 12px 0 0; }
.dr-body { padding: 6px 16px 14px; }

/* Tables, blocks */
.tablewrap { overflow-x: auto; margin: 10px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.tablewrap.wide table { font-size: .88rem; min-width: 1100px; }
.tablewrap.sp th:nth-child(2), .tablewrap.sp td:nth-child(2) { background: color-mix(in srgb, var(--gold-soft) 55%, transparent); border-left: 3px solid var(--gold); }
.tablewrap.sp th:nth-child(3), .tablewrap.sp td:nth-child(3) { background: color-mix(in srgb, var(--jade-soft) 55%, transparent); border-left: 3px solid var(--jade); }
.tablewrap.sp th:nth-child(2) { color: var(--gold); font-size: .9rem; font-weight: 800; }
.tablewrap.sp th:nth-child(3) { color: var(--jade-deep); font-size: .9rem; font-weight: 800; }
.tablewrap.sp td:first-child { font-weight: 700; white-space: nowrap; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--soft); font-size: .8rem; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
pre { margin: 0; white-space: pre; overflow-x: auto; }
pre.block { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: .8rem; line-height: 1.45; margin: 10px 0; }
.say { position: relative; background: var(--violet-soft); border: 1px solid var(--violet); border-radius: 12px; padding: 12px 74px 12px 14px; margin: 10px 0; max-width: 82ch; }
.say::before { content: "SAY TO CLAUDE"; display: block; font-size: .68rem; font-weight: 800; letter-spacing: .08em; color: var(--violet); margin-bottom: 4px; }
.say pre { white-space: pre-wrap; word-break: break-word; font: 600 .95rem/1.5 ui-monospace, Consolas, monospace; }
.say .copy { position: absolute; top: 10px; right: 10px; border: 1px solid var(--violet); background: var(--card); color: var(--violet); border-radius: 8px; padding: 4px 10px; font: inherit; font-size: .8rem; cursor: pointer; }
blockquote { margin: 18px 0 6px; padding: 10px 14px; border-radius: 12px; background: var(--soft); border-left: 4px solid var(--muted); max-width: 82ch; }
.gatebox { border: 1px solid var(--coral); background: color-mix(in srgb, var(--coral-soft) 45%, var(--card)); border-radius: 14px; padding: 4px 14px 8px; margin: 18px 0; max-width: 82ch; }
.gatebox blockquote.gate { background: none; border: 0; padding: 8px 0 2px; margin: 0; color: var(--coral); }
blockquote.gate { background: var(--coral-soft); border-left-color: var(--coral); color: var(--ink); }
ul, ol { padding-left: 24px; }
li { margin: 4px 0; }
li.gate-item { list-style: none; margin-left: -24px; }
li.gate-item label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
li.gate-item label:hover { background: var(--soft); }
li.gate-item input { width: 18px; height: 18px; margin-top: 4px; accent-color: var(--coral); flex: none; }

/* Task cards */
details { background: var(--card); border: 1px solid var(--line); border-radius: 14px; margin: 8px 0; }
summary { border-radius: 14px; list-style: none; cursor: pointer; padding: 11px 14px; display: flex; gap: 12px; align-items: flex-start; }
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--soft); }
details.task[open], details.role-card[open] { box-shadow: 0 4px 18px rgba(0,0,0,.06); }
details.done { opacity: .62; }
summary .ttl { flex: 1; font-weight: 600; min-width: 0; }
summary .ttl b { color: var(--muted); margin-right: 4px; }
summary .ttl small { display: block; font-weight: 400; color: var(--muted); font-size: .82rem; }
details.done summary .ttl { text-decoration: line-through; }
summary .chev { color: var(--muted); transition: transform .2s; margin-top: 2px; flex: none; }
details[open] > summary .chev { transform: rotate(90deg); }
.tick { flex: none; width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--muted); background: var(--card); cursor: pointer; display: grid; place-items: center; color: #fff; font-size: 15px; font-weight: 900; padding: 0; margin-top: 1px; }
.tick[aria-checked="true"] { background: var(--jade); border-color: var(--jade); }
.badge { flex: none; font-size: .68rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 3px 8px; border-radius: 99px; margin-top: 3px; }
.badge.you { background: var(--jade-soft); color: var(--jade-deep); }
.badge.claude { background: var(--violet-soft); color: var(--violet); }
.badge.both { background: var(--blue-soft); color: var(--blue); }
.badge.card { background: var(--gold-soft); color: var(--gold); }
.badge.later { background: var(--soft); color: var(--muted); border: 1px dashed var(--muted); }
.st { flex: none; font-size: .7rem; font-weight: 800; padding: 3px 9px; border-radius: 99px; white-space: nowrap; margin-top: 3px; }
.st.need { background: var(--coral-soft); color: var(--coral); }
.st.built { background: var(--gold-soft); color: var(--gold); }
.st.ok { background: var(--jade-soft); color: var(--jade-deep); }
.st.part { background: var(--gold-soft); color: var(--gold); }
.st.no { background: var(--coral-soft); color: var(--coral); }
.body { padding: 6px 18px 16px; border-top: 1px solid var(--line); }
.body p.k-why { color: var(--muted); }
.body p.k-done { background: var(--jade-soft); border-left: 4px solid var(--jade); border-radius: 8px; padding: 8px 12px; }
.body p.k-status { background: var(--gold-soft); border-left: 4px solid var(--gold); border-radius: 8px; padding: 8px 12px; }
details.role-later { border-style: dashed; background: var(--soft); }
.hidden, .hide-role, .hide-q { display: none !important; }
body.searching .sec > :not(h2):not(.q-hit) { display: none !important; }
body.searching .sec.q-none { display: none; }
body.searching .intro, body.searching .sec-bar { display: none; }

/* Start here panel */
.dash { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); margin: 10px 0 16px; }
.d-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
.d-card h4 { margin: 0 0 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.d-big { font-size: 2.1rem; font-weight: 800; line-height: 1; color: var(--jade-deep); }
.d-sub { color: var(--muted); font-size: .86rem; margin: 4px 0 10px; }
.d-steps { display: grid; gap: 5px; margin-top: 12px; }
.d-step { display: grid; grid-template-columns: 74px 1fr 42px; gap: 8px; align-items: center; font-size: .8rem; border: 0; background: none; color: var(--ink); padding: 0; cursor: pointer; text-align: left; font-family: inherit; }
.d-step .track { height: 6px; }
.d-step span:last-child { color: var(--muted); text-align: right; }
.d-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.d-list li { margin: 0; }
.d-list button { display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 9px; padding: 6px 9px; font: inherit; font-size: .85rem; cursor: pointer; }
.d-list button:hover { border-color: var(--jade); }
.d-list b { flex: none; color: var(--muted); font-size: .78rem; min-width: 34px; }
.d-more { font-size: .78rem; color: var(--muted); margin-top: 6px; }

/* App in one page */
.journey { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); counter-reset: j; }
.jstep { position: relative; border: 1px solid var(--line); border-top: 4px solid var(--jade); border-radius: 12px; padding: 10px 12px; background: var(--bg); font-size: .86rem; }
.jstep b { display: block; font-size: 1rem; margin-bottom: 2px; }
.jstep small { color: var(--muted); font-size: .84rem; }

/* Setup guide (staging and production, step by step) */
.guide { display: grid; gap: 16px; margin: 14px 0; }
.g-part { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
.g-head { padding: 12px 16px; background: var(--soft); border-bottom: 1px solid var(--line); }
.g-part:nth-child(1) .g-head { background: var(--gold-soft); border-left: 6px solid var(--gold); }
.g-part:nth-child(3) .g-head, .g-part:nth-child(4) .g-head { background: var(--jade-soft); border-left: 6px solid var(--jade); }
.g-part:nth-child(2) .g-head, .g-part:nth-child(5) .g-head { border-left: 6px solid var(--muted); }
.g-title { font-weight: 800; font-size: 1.05rem; }
.g-sub { color: var(--muted); font-size: .88rem; }
.g-steps { list-style: none; margin: 0; padding: 6px 0; }
.g-step { display: grid; grid-template-columns: 34px 1fr; gap: 10px; padding: 8px 16px; margin: 0; position: relative; }
.g-step + .g-step { border-top: 1px solid var(--line); }
.g-num { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: .82rem; background: var(--soft); color: var(--ink); border: 2px solid var(--line); margin-top: 1px; }
.g-step.done .g-num { background: var(--jade); border-color: var(--jade); color: #fff; }
.g-step.done .g-name { text-decoration: line-through; color: var(--muted); }
.g-line { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.g-task { font-weight: 800; font-size: .8rem; text-decoration: none; background: var(--blue-soft); color: var(--blue); padding: 1px 8px; border-radius: 99px; }
.g-name { font-weight: 700; }
.g-meta { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: .78rem; color: var(--muted); }
.g-meta .badge, .g-meta .st { margin-top: 0; }
.g-detail { color: var(--muted); font-size: .9rem; max-width: 82ch; }

/* Side-by-side comparison, row by row (built from a table with (staging) and (production) headers) */
.cmp { margin: 12px 0; }
.cmp-head { position: sticky; top: var(--bar-h, 110px); z-index: 5; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 6px 0; background: var(--bg); }
.cmp-h { border-radius: 12px; padding: 10px 14px; font-size: .95rem; border: 2px solid; }
.cmp-h b { font-size: 1.15rem; letter-spacing: .05em; margin-right: 8px; }
.cmp-h.stg { background: var(--gold-soft); border-color: var(--gold); color: var(--gold); }
.cmp-h.prd { background: var(--jade-soft); border-color: var(--jade); color: var(--jade-deep); }
.cmp-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; margin: 0 0 14px; }
.cmp-tool { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: baseline; background: var(--ink); color: var(--bg); border-radius: 10px 10px 0 0; padding: 7px 14px; }
.cmp-name { font-weight: 800; font-size: 1.05rem; }
.cmp-x { font-size: .84rem; opacity: .9; }
.cmp-x i { font-style: normal; opacity: .65; margin-right: 4px; }
.cmp-tool a { color: inherit; }
.cmp-side { padding: 10px 14px; border: 2px solid; border-top: 0; background: var(--card); }
.cmp-side.stg { border-color: var(--gold); border-left-width: 8px; border-radius: 0 0 0 12px; background: color-mix(in srgb, var(--gold-soft) 45%, var(--card)); }
.cmp-side.prd { border-color: var(--jade); border-left-width: 8px; border-radius: 0 0 12px 0; background: color-mix(in srgb, var(--jade-soft) 45%, var(--card)); }
.cmp-side dl { margin: 0; display: grid; grid-template-columns: 8.5em 1fr; gap: 6px 10px; }
.cmp-side dt { color: var(--muted); font-size: .76rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding-top: 2px; }
.cmp-side dd { margin: 0; font-size: .9rem; overflow-wrap: anywhere; }
.cmp-side .none { color: var(--muted); font-style: italic; }
@media (max-width: 900px) {
  .cmp-head { grid-template-columns: 1fr; position: static; }
  .cmp-row { grid-template-columns: 1fr; }
  .cmp-side.stg { border-radius: 0; }
  .cmp-side.prd { border-radius: 0 0 12px 12px; margin-top: 0; }
  .cmp-side dl { grid-template-columns: 1fr; gap: 0; } .cmp-side dd { margin-bottom: 6px; }
}
.sbs { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; margin: 12px 0; }
.sbs-col { min-width: 0; border-radius: 16px; padding: 0 12px 12px; border: 3px solid; }
.sbs-col.stg { border-color: var(--gold); background: color-mix(in srgb, var(--gold-soft) 28%, transparent); }
.sbs-col.prd { border-color: var(--jade); background: color-mix(in srgb, var(--jade-soft) 28%, transparent); }
.sbs-col > h3 { margin-top: 12px; }
.sbs-col .am-cards { grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
@media (max-width: 1100px) { .sbs { grid-template-columns: 1fr; } }

/* Roadmap */
.js .map-text { display: none; }
.roadmap { display: grid; gap: 12px; margin: 12px 0; }
.rm-steps { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.rm-later { border: 2px dashed var(--line); background: var(--soft); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.rm-later .rm-num { background: var(--muted); }
.rm-later .rm-chips { flex-direction: row; flex-wrap: wrap; }
.chip .dot.later { background: var(--muted); }
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

/* Hand-drawn diagrams (the html code blocks) */
.fig { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 14px 0; }
.fig-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-weight: 800; margin-bottom: 8px; }
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
footer { margin-top: 48px; color: var(--muted); font-size: .85rem; }
@media (max-width: 640px) {
  h1 { font-size: 1.45rem; }
  h2 { font-size: 1.2rem; }
  summary { gap: 8px; padding: 11px 10px; }
  .badge { display: none; }
  .body { padding: 4px 12px 14px; }
  .say { padding-right: 14px; padding-top: 40px; }
  .say::before { position: absolute; top: 14px; left: 14px; }
  .g-step { padding: 8px 12px; grid-template-columns: 30px 1fr; }
  .brand small { display: none; }
  .search { max-width: none; order: 5; flex-basis: 100%; }
  .tools .btn:not(#theme) { display: none; }
  .progress { order: 4; flex-basis: 100%; max-width: none; }
  .bar-inner { gap: 6px; padding: 8px 12px; }
}
@media print {
  .bar-top, .side { display: none; }
  .layout { display: block; }
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
  document.documentElement.classList.add('js');

  var main = document.querySelector('main');
  var labels = { YOU: 'You', CLAUDE: 'Claude', BOTH: 'Both', CARD: 'Card', LATER: 'Later' };
  var tasks = [];
  var later = [];
  var cards = [];
  var byId = {};
  var defaults = {};
  function isDone(d) { return Object.prototype.hasOwnProperty.call(state, d.id) ? !!state[d.id] : !!defaults[d.id]; }

  // 1. Turn each <details> with a [ROLE] tag into a task card (status read from its summary).
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
    var small = (rest.match(/<small>([\\s\\S]*?)<\\/small>/) || [])[1] || '';
    small = small.replace(/<[^>]+>/g, '');
    if (role === 'LATER') later.push(d);
    if (role === 'CARD') cards.push(d);
    if (role !== 'CARD' && role !== 'LATER') {
      d.classList.add('task');
      defaults[d.id] = /(^|\\u00b7)\\s*Done\\b/.test(small);
      var tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'tick';
      tick.setAttribute('role', 'checkbox');
      tick.setAttribute('aria-label', 'Mark as done');
      tick.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        state[d.id] = !isDone(d);
        save();
        render();
      });
      s.appendChild(tick);
      tasks.push(d);
      if (d.id) byId[d.id] = d;
    }
    var badge = document.createElement('span');
    badge.className = 'badge ' + role.toLowerCase();
    badge.textContent = labels[role];
    s.appendChild(badge);
    var ttl = document.createElement('span');
    ttl.className = 'ttl';
    ttl.innerHTML = rest;
    s.appendChild(ttl);
    if (role !== 'CARD' && role !== 'LATER') {
      var need = /waiting (for|on) (your|you)|phone check|your (look|check|approval|answer)|is yours|waits for you/i.test(small);
      var built = !need && /\\b(built|drawn|planned)\\b/i.test(small);
      if (need || built) {
        var st = document.createElement('span');
        st.className = 'st ' + (need ? 'need' : 'built');
        st.textContent = need ? 'Needs you' : 'Built';
        s.appendChild(st);
        d.setAttribute('data-status', need ? 'need' : 'built');
      }
    }
    var chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '\\u25B8';
    s.appendChild(chev);
    // Inside a task: "Why", "Status" and "Done when" paragraphs get their own look.
    Array.prototype.forEach.call(body.children, function (p) {
      if (p.tagName !== 'P' || !p.firstElementChild || p.firstElementChild.tagName !== 'STRONG' || p.firstChild !== p.firstElementChild) return;
      var k = p.firstElementChild.textContent;
      if (/^Done when/.test(k)) p.classList.add('k-done');
      else if (/^Status/.test(k)) p.classList.add('k-status');
      else if (/^Why/.test(k)) p.classList.add('k-why');
    });
  });

  // 2. Gate ticks.
  Array.prototype.forEach.call(main.querySelectorAll('li.gate-item input'), function (cb, n) {
    var id = 'gate:' + n + ':' + cb.parentNode.textContent.trim().slice(0, 40);
    cb.checked = !!state[id] || cb.checked;
    cb.addEventListener('change', function () { state[id] = cb.checked; save(); });
  });

  // 3. Sections: each h2 and everything after it becomes one <section>. Sections not marked
  //    {open} keep their first paragraph, tasks, cards and gates on screen and fold the rest
  //    into drawers titled by their sub-heading.
  var kids = Array.prototype.slice.call(main.children);
  var intro = document.createElement('div');
  intro.className = 'intro';
  var sections = [];
  var cur = null;
  kids.forEach(function (el) {
    if (el.tagName === 'FOOTER') return;
    if (el.tagName === 'H2') {
      cur = { h: el, el: document.createElement('section'), nodes: [], tasks: [], later: [], gate: null };
      cur.el.className = 'sec';
      sections.push(cur);
      main.insertBefore(cur.el, el);
      cur.el.appendChild(el);
      return;
    }
    if (!cur) { intro.appendChild(el); return; }
    cur.nodes.push(el);
  });
  main.insertBefore(intro, main.firstChild);

  function isTaskish(el) { return el.tagName === 'DETAILS'; }
  function isGateList(el) { return (el.tagName === 'UL' || el.tagName === 'OL') && el.querySelector(':scope > li.gate-item'); }
  function metaOf(nodes) {
    var c = { p: 0, t: 0, d: 0, l: 0 };
    nodes.forEach(function (n) {
      if (n.tagName === 'P' || n.tagName === 'BLOCKQUOTE') c.p++;
      else if (n.classList && (n.classList.contains('tablewrap') || n.classList.contains('cmp'))) c.t++;
      else if (n.classList && (n.classList.contains('diagram') || n.classList.contains('fig') || n.classList.contains('sbs'))) c.d++;
      else if (n.tagName === 'UL' || n.tagName === 'OL') c.l++;
    });
    var out = [];
    if (c.p) out.push(c.p + (c.p === 1 ? ' paragraph' : ' paragraphs'));
    if (c.l) out.push(c.l + (c.l === 1 ? ' list' : ' lists'));
    if (c.t) out.push(c.t + (c.t === 1 ? ' table' : ' tables'));
    if (c.d) out.push(c.d + (c.d === 1 ? ' picture' : ' pictures'));
    return out.join(' \\u00b7 ');
  }
  function makeDrawer(title, nodes) {
    var d = document.createElement('details');
    d.className = 'drawer';
    var s = document.createElement('summary');
    s.innerHTML = '<span class="dr-ic">i</span><span class="dr-ttl"></span><span class="dr-meta"></span><span class="chev">\\u25B8</span>';
    s.querySelector('.dr-ttl').textContent = title;
    s.querySelector('.dr-meta').textContent = metaOf(nodes);
    d.appendChild(s);
    var b = document.createElement('div');
    b.className = 'dr-body';
    nodes.forEach(function (n) { b.appendChild(n); });
    d.appendChild(b);
    return d;
  }
  sections.forEach(function (sec) {
    var nodes = sec.nodes.filter(function (n) { return n.tagName !== 'HR'; });
    if (sec.h.classList.contains('open-sec')) {
      nodes.forEach(function (n) { sec.el.appendChild(n); });
    } else {
      if (nodes.length && nodes[0].tagName === 'P') {
        var lede = nodes.shift();
        lede.classList.add('lede');
        sec.el.appendChild(lede);
      }
      var title = null;
      var titleEl = null;
      var buf = [];
      var first = true;
      function flush(final) {
        if (buf.length) {
          var name = title || (first ? 'Background and details' : 'More detail');
          sec.el.appendChild(makeDrawer(name, buf));
          if (titleEl) titleEl.remove();
        } else if (titleEl) {
          titleEl.classList.add('subhead');
          sec.el.appendChild(titleEl);
        }
        buf = []; title = null; titleEl = null; first = false;
      }
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.tagName === 'H3') { flush(); title = n.textContent; titleEl = n; continue; }
        if (isTaskish(n)) { flush(); sec.el.appendChild(n); continue; }
        if (n.matches('blockquote.gate')) {
          flush();
          var box = document.createElement('div');
          box.className = 'gatebox';
          box.appendChild(n);
          if (nodes[i + 1] && isGateList(nodes[i + 1])) { box.appendChild(nodes[i + 1]); i++; }
          sec.el.appendChild(box);
          continue;
        }
        buf.push(n);
      }
      flush(true);
    }
    // Which tasks and gate belong to this section (for counts and the roadmap).
    Array.prototype.forEach.call(sec.el.querySelectorAll('details.task'), function (d) { if (d.parentNode.closest('details.task') === null) sec.tasks.push(d); });
    Array.prototype.forEach.call(sec.el.querySelectorAll('details.role-later'), function (d) { sec.later.push(d); });
    var gates = sec.el.querySelectorAll('blockquote.gate');
    if (gates.length) sec.gate = gates[gates.length - 1];
    if (/^START NOW/.test(sec.h.textContent)) sec.h.classList.add('paper');
    if (/^FUTURE SCOPE/.test(sec.h.textContent)) sec.h.classList.add('future');
    if (sec.tasks.length) {
      var bar = document.createElement('div');
      bar.className = 'sec-bar';
      bar.innerHTML = '<i></i>';
      sec.h.insertAdjacentElement('afterend', bar);
      sec.bar = bar.firstChild;
    }
  });

  function openTask(d) {
    d.classList.remove('hidden', 'hide-role', 'hide-q');
    var p = d.parentNode;
    while (p && p !== main) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentNode; }
    d.open = true;
    document.body.classList.remove('nav-open');
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 4. The side menu, in groups.
  function navLabel(t) {
    var m = t.match(/^STEP (\\d+):\\s*([^(,]+)/);
    if (m) return { n: m[1], text: m[2].trim() };
    if (/^START NOW/.test(t)) return { n: 'S', text: 'Start now: the slow track' };
    if (/^FUTURE SCOPE/.test(t)) return { n: 'F', text: 'Future scope' };
    if (/^The CEO review/.test(t)) return { n: '', text: 'The CEO review (9 Nov)' };
    return { n: '', text: t.split(/[:(]/)[0].trim() };
  }
  function groupOf(t) {
    if (/^(Start here|The CEO review|Your app in one page|Staging and production, step by step|The map)/.test(t)) return 0;
    if (/^(START NOW|STEP \\d)/.test(t)) return 1;
    if (/^(FUTURE SCOPE|Snapshot|Changelog)/.test(t)) return 3;
    return 2;
  }
  var groupNames = ['Start', 'The plan, in order', 'Know your setup', 'Later and history'];
  var side = document.getElementById('side');
  var groupEls = groupNames.map(function (name) {
    var box = document.createElement('div');
    var h = document.createElement('h5');
    h.textContent = name;
    box.appendChild(h);
    return box;
  });
  sections.forEach(function (sec) {
    var lab = navLabel(sec.h.textContent);
    sec.label = lab;
    var a = document.createElement('a');
    a.href = '#' + sec.h.id;
    a.innerHTML = '<span class="n"></span><span class="lbl"><span class="t"></span></span><span class="c"></span>';
    a.querySelector('.n').textContent = lab.n || '\\u2022';
    a.querySelector('.t').textContent = lab.text;
    if (sec.tasks.length) {
      var mini = document.createElement('span');
      mini.className = 'mini';
      mini.innerHTML = '<i></i>';
      a.querySelector('.lbl').appendChild(mini);
      sec.navBar = mini.firstChild;
      sec.navCount = a.querySelector('.c');
      var hc = document.createElement('span');
      hc.className = 'count';
      sec.h.appendChild(hc);
      sec.headCount = hc;
    }
    a.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    sec.navLink = a;
    groupEls[groupOf(sec.h.textContent)].appendChild(a);
  });
  groupEls.forEach(function (g) { if (g.children.length > 1) side.appendChild(g); });
  document.getElementById('menu').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
  document.getElementById('scrim').addEventListener('click', function () { document.body.classList.remove('nav-open'); });
  if ('IntersectionObserver' in window) {
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var on = null;
      for (var i = 0; i < sections.length; i++) { if (visible[sections[i].el.id || sections[i].h.id]) { on = sections[i]; break; } }
      if (!on) return;
      sections.forEach(function (s) { s.navLink.classList.toggle('on', s === on); });
    }, { rootMargin: '-120px 0px -55% 0px' });
    sections.forEach(function (s) { s.el.id = 'sec-' + s.h.id; io.observe(s.el); });
  }

  // The bar height drives the sticky offsets.
  var barTop = document.querySelector('.bar-top');
  function setBarHeight() { document.documentElement.style.setProperty('--bar-h', barTop.offsetHeight + 'px'); }
  setBarHeight();
  window.addEventListener('resize', setBarHeight);

  // 5. The clickable roadmap, drawn from the sections and tasks (so it never drifts).
  var chips = [];
  var rmBars = [];
  var roadmap = document.getElementById('roadmap');
  function chipFor(d, dotClass) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.innerHTML = '<span class="dot ' + dotClass + '"></span><span></span>';
    chip.lastChild.textContent = d.getAttribute('data-short') || d.querySelector('.ttl').textContent;
    chip.title = d.querySelector('.ttl').textContent.trim();
    chip.addEventListener('click', function () { openTask(d); });
    return chip;
  }
  function roleOf(d) { return d.classList.contains('role-you') ? 'you' : d.classList.contains('role-claude') ? 'claude' : 'both'; }
  if (roadmap) {
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
        sec.later.forEach(function (d) { ll.appendChild(chipFor(d, 'later')); });
        laterCard.appendChild(ll);
        return;
      }
      if (!sec.tasks.length) return;
      var paper = /^START NOW/.test(sec.h.textContent);
      var m = sec.h.textContent.match(/^STEP (\\d+):\\s*([^(]+)(?:\\(([^)]*)\\))?/);
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
        var chip = chipFor(d, roleOf(d));
        chips.push({ el: chip, d: d });
        list.appendChild(chip);
      });
      card.appendChild(list);
      if (sec.gate) {
        var g = document.createElement('button');
        g.type = 'button';
        g.className = 'rm-gate';
        var gm = sec.gate.textContent.match(/GATE \\w+/);
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

  // 6. The setup guide: each step shows who does it, its time and its live status.
  var guideSteps = Array.prototype.map.call(main.querySelectorAll('.g-step[data-task]'), function (li) {
    var d = byId[li.getAttribute('data-task')];
    if (!d) return null;
    var meta = li.querySelector('.g-meta');
    var role = roleOf(d);
    var b = document.createElement('span');
    b.className = 'badge ' + role;
    b.textContent = labels[role.toUpperCase()];
    meta.appendChild(b);
    var small = d.querySelector('.ttl small');
    if (small) {
      var t = document.createElement('span');
      t.textContent = small.textContent.replace(/^\\s*\\u00b7\\s*/, '');
      meta.appendChild(t);
    }
    li.querySelector('.g-task').addEventListener('click', function (e) { e.preventDefault(); openTask(d); history.replaceState(null, '', '#' + d.id); });
    return { li: li, d: d, num: li.querySelector('.g-num'), n: li.querySelector('.g-num').textContent };
  }).filter(Boolean);

  // 7. Start here: progress, what to do next, what waits on you.
  var dash = document.getElementById('dash');
  function taskLine(d) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    var num = d.querySelector('.ttl b');
    btn.innerHTML = '<b></b><span></span>';
    btn.firstChild.textContent = num ? num.textContent : '';
    btn.lastChild.textContent = d.getAttribute('data-short') || d.querySelector('.ttl').textContent;
    btn.addEventListener('click', function () { openTask(d); });
    li.appendChild(btn);
    return li;
  }
  function renderDash(done) {
    if (!dash) return;
    dash.className = 'dash';
    dash.innerHTML = '';
    var pct = tasks.length ? Math.round(done * 100 / tasks.length) : 0;
    var c1 = document.createElement('div');
    c1.className = 'd-card';
    c1.innerHTML = '<h4>Your progress</h4><div class="d-big">' + pct + '%</div><div class="d-sub">' + done + ' of ' + tasks.length + ' tasks done. Future scope is not counted.</div><div class="track"><i style="width:' + pct + '%"></i></div><div class="d-steps"></div>';
    var ds = c1.querySelector('.d-steps');
    sections.forEach(function (sec) {
      if (!sec.tasks.length || !sec.label.n) return;
      var n = sec.tasks.filter(isDone).length;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'd-step';
      row.innerHTML = '<span></span><span class="track"><i style="width:' + Math.round(n * 100 / sec.tasks.length) + '%"></i></span><span>' + n + '/' + sec.tasks.length + '</span>';
      row.firstChild.textContent = sec.label.n === 'S' ? 'Slow track' : 'Step ' + sec.label.n;
      row.title = sec.label.text;
      row.addEventListener('click', function () { sec.h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      ds.appendChild(row);
    });
    dash.appendChild(c1);
    function listCard(title, list, empty, max) {
      var c = document.createElement('div');
      c.className = 'd-card';
      c.innerHTML = '<h4></h4><ul class="d-list"></ul>';
      c.firstChild.textContent = title;
      var ul = c.querySelector('ul');
      list.slice(0, max).forEach(function (d) { ul.appendChild(taskLine(d)); });
      if (!list.length) { var p = document.createElement('div'); p.className = 'd-sub'; p.textContent = empty; c.appendChild(p); }
      if (list.length > max) { var more = document.createElement('div'); more.className = 'd-more'; more.textContent = 'and ' + (list.length - max) + ' more in the steps below'; c.appendChild(more); }
      dash.appendChild(c);
    }
    var open = tasks.filter(function (d) { return !isDone(d); });
    listCard('Do next, in order', open.filter(function (d) { return d.id.indexOf('tS-') !== 0; }), 'Every step is done.', 5);
    listCard('Waiting on you', open.filter(function (d) { return d.getAttribute('data-status') === 'need'; }), 'Nothing is waiting on you.', 6);
    listCard('Slow track still open', open.filter(function (d) { return d.id.indexOf('tS-') === 0; }), 'The slow track is done.', 8);
  }

  var nextBtn = document.getElementById('next');
  function render() {
    var done = 0;
    var next = null;
    tasks.forEach(function (d) {
      var on = isDone(d);
      d.classList.toggle('done', on);
      var t = d.querySelector('.tick');
      t.setAttribute('aria-checked', on ? 'true' : 'false');
      t.textContent = on ? '\\u2713' : '';
      // The slow track (ids tS-*) runs beside the steps, so "Next" follows the steps only.
      if (on) done++; else if (!next && d.id.indexOf('tS-') !== 0) next = d;
    });
    sections.forEach(function (sec) {
      if (!sec.tasks.length) return;
      var n = sec.tasks.filter(isDone).length;
      var pct = Math.round(n * 100 / sec.tasks.length) + '%';
      sec.navCount.textContent = n + '/' + sec.tasks.length;
      sec.navBar.style.width = pct;
      sec.headCount.textContent = n + ' of ' + sec.tasks.length + ' done';
      sec.bar.style.width = pct;
    });
    chips.forEach(function (c) { c.el.classList.toggle('done', isDone(c.d)); });
    rmBars.forEach(function (r) {
      var n = r.sec.tasks.filter(isDone).length;
      r.bar.style.width = Math.round(n * 100 / r.sec.tasks.length) + '%';
    });
    guideSteps.forEach(function (g) {
      var on = isDone(g.d);
      g.li.classList.toggle('done', on);
      g.num.textContent = on ? '\\u2713' : g.n;
    });
    document.getElementById('count').textContent = done + ' of ' + tasks.length + ' tasks done';
    document.getElementById('fill').style.width = (tasks.length ? Math.round(done * 100 / tasks.length) : 0) + '%';
    if (next) {
      nextBtn.classList.remove('hidden');
      nextBtn.innerHTML = '<b>Next:</b> ' + next.querySelector('.ttl').innerHTML.replace(/<small>[\\s\\S]*<\\/small>/, '');
      nextBtn.onclick = function () { openTask(next); };
    } else {
      nextBtn.classList.add('hidden');
    }
    renderDash(done);
  }
  render();

  // 8. Filters (whose task) and search.
  var filters = document.querySelectorAll('[data-filter]');
  Array.prototype.forEach.call(filters, function (b) {
    b.addEventListener('click', function () {
      var f = b.getAttribute('data-filter');
      Array.prototype.forEach.call(filters, function (x) { x.classList.toggle('on', x === b); });
      tasks.concat(later).forEach(function (d) {
        var show = f === 'all' || d.classList.contains('role-' + f) || d.classList.contains('role-both');
        if (f !== 'all' && d.classList.contains('role-later')) show = false;
        d.classList.toggle('hide-role', !show);
      });
    });
  });
  var q = document.getElementById('q');
  var qinfo = document.getElementById('qinfo');
  var searchable = tasks.concat(later, cards, Array.prototype.slice.call(main.querySelectorAll('details.drawer')));
  var qTimer = null;
  function runSearch() {
    var v = q.value.trim().toLowerCase();
    document.body.classList.toggle('searching', !!v);
    var hits = 0;
    searchable.forEach(function (d) {
      var hit = !!v && d.textContent.toLowerCase().indexOf(v) >= 0;
      d.classList.toggle('q-hit', hit);
      if (hit && !d.parentNode.closest('details')) hits++;
    });
    sections.forEach(function (sec) {
      sec.el.classList.toggle('q-none', !!v && !sec.el.querySelector('.q-hit'));
      if (v && sec.h.textContent.toLowerCase().indexOf(v) >= 0) sec.el.classList.remove('q-none');
    });
    if (v) window.scrollTo(0, 0);
    qinfo.textContent = v ? (hits ? hits + ' found' : 'nothing found') : '';
  }
  q.addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(runSearch, 120); });
  q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; runSearch(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  });

  document.getElementById('expand').addEventListener('click', function () {
    var open = this.getAttribute('data-open') !== '1';
    Array.prototype.forEach.call(main.querySelectorAll('details'), function (d) { d.open = open; });
    this.setAttribute('data-open', open ? '1' : '0');
    this.textContent = open ? 'Close all' : 'Open all';
  });

  // 9. Diagrams: drawn when they come into view (a closed drawer draws when it opens).
  var diagrams = Array.prototype.map.call(main.querySelectorAll('pre.mermaid'), function (pre) {
    return { pre: pre, src: pre.textContent, drawn: false };
  });
  function isDark() {
    var cur = document.documentElement.getAttribute('data-theme');
    return cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  var mermaidReady = false;
  function drawVisible() {
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
    if (!mermaidReady) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default', flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true } });
      mermaidReady = true;
    }
    var todo = diagrams.filter(function (d) { return !d.drawn && !d.pre.closest('details:not([open])'); });
    if (!todo.length) return;
    todo.forEach(function (d) { d.drawn = true; d.pre.removeAttribute('data-processed'); d.pre.textContent = d.src; });
    window.mermaid.run({ nodes: todo.map(function (d) { return d.pre; }) }).catch(function () {});
  }
  drawVisible();
  main.addEventListener('toggle', function (e) { if (e.target.open) drawVisible(); }, true);

  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var nextTheme = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', nextTheme);
    try { localStorage.setItem(KEY + ':theme', nextTheme); } catch (e) {}
    mermaidReady = false;
    diagrams.forEach(function (d) { d.drawn = false; });
    drawVisible();
  });

  // 10. Copy buttons on the "say to Claude" boxes.
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

  // 11. Opening a link to a task (#t1-2) or anything inside a drawer opens it.
  function openHash() {
    var el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!el) return;
    var p = el;
    while (p && p !== main) { if (p.tagName === 'DETAILS') p.open = true; p = p.parentNode; }
    setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0);
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
    <div class="row top">
      <div class="row" style="gap:10px">
        <button class="btn" type="button" id="menu" aria-label="Open the sections menu">&#9776; Sections</button>
        <span class="brand">taskdrop<span class="dot">.</span> <small>ultimate plan</small></span>
      </div>
      <div class="progress"><div class="lbl" id="count"></div><div class="track"><i id="fill"></i></div></div>
      <div class="search"><input id="q" type="search" placeholder="Search tasks and notes  ( / )" aria-label="Search the plan"></div>
      <span class="qinfo" id="qinfo"></span>
      <div class="row tools" style="gap:6px">
        <button class="btn on" type="button" data-filter="all">All</button>
        <button class="btn" type="button" data-filter="you">Mine</button>
        <button class="btn" type="button" data-filter="claude">Claude's</button>
        <button class="btn" type="button" id="expand">Open all</button>
        <button class="btn" type="button" id="theme" aria-label="Switch dark or light">&#9680;</button>
      </div>
    </div>
    <button class="next hidden" type="button" id="next"></button>
  </div>
</div>
<div class="layout">
<nav class="side" id="side" aria-label="Sections"></nav>
<div class="scrim" id="scrim"></div>
<main>
${content}
<footer>Made from <code>docs/ULTIMATE_PLAN.md</code> by <code>node scripts/build-plan-html.mjs</code>. Your ticks are saved in this browser only; a task marked "Done" in the plan starts ticked. Planning aid, not legal, tax or investment advice.</footer>
</main>
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>${JS}</script>
</body>
</html>
`;

writeFileSync(dest, html);
console.log(`Wrote ${dest} (${Math.round(html.length / 1024)} KB)`);
