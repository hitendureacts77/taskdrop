// ListPage (docs/design/desktop-web/PLAN.md, package 5): off desktop it must hand
// back what a list screen rendered before (toolbar inline, then the children; no
// filter column, no frame); on desktop it draws the 1760 page, the 240 filter card
// and the toolbar row. Same harness as FormPage.test.mjs: the file is compiled with
// TypeScript, its app imports are swapped for stand-ins, and each piece is called
// as a function so its element tree can be inspected without a renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';

const require = createRequire(import.meta.url);

function PillStub() {
  return null;
}
const lp = {
  layout: { desktop: false },
  theme: {
    colors: {
      surface: 'SURFACE',
      surface2: 'SURFACE2',
      line: 'LINE',
      ink: 'INK',
      muted: 'MUTED',
      accentSoft: 'ACCENTSOFT',
      accentDeep: 'ACCENTDEEP',
    },
    radius: { lg: 18 },
  },
  Pill: PillStub,
};
globalThis.__listPageTest = lp;

const stubs = {
  'react-native':
    "export const View = 'View'; export const Text = 'Text'; export const ScrollView = 'ScrollView'; export const Pressable = 'Pressable';",
  '../lib/layout': 'export const useLayout = () => globalThis.__listPageTest.layout;',
  '../providers/ThemeProvider': 'export const useTheme = () => globalThis.__listPageTest.theme;',
  './kit': 'export const Pill = globalThis.__listPageTest.Pill;',
  './primitives': 'export const tx = (fontWeight, fontSize, color, extra) => ({ fontWeight, fontSize, color, ...extra });',
};

const hooks = `
let ts; let stubs;
export async function initialize(data) {
  ts = (await import(data.ts)).default;
  stubs = data.stubs;
}
export async function resolve(specifier, context, next) {
  if (context.parentURL && context.parentURL.endsWith('/ListPage.tsx') && specifier in stubs) {
    return { url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (!url.endsWith('/ListPage.tsx')) return next(url, context);
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL(url), 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}`;

register('data:text/javascript,' + encodeURIComponent(hooks), {
  data: { ts: pathToFileURL(require.resolve('typescript')).href, stubs },
});

const { ListPage, SegmentedTabs, listPageParts, segmentedTabsMode, segmentedTabLabel, LIST_MAX, FILTER_WIDTH } =
  await import('./ListPage.tsx');

const grid = React.createElement('View', { key: 'g' }, 'cards');
const tabs = React.createElement('View', { key: 't' }, 'tabs');
const sort = React.createElement('View', { key: 's' }, 'sort');
const filterBox = React.createElement('View', { key: 'f' }, 'filters');

/** Every element in a tree, depth first. */
function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
  } else if (node && typeof node === 'object' && 'props' in node) {
    out.push(node);
    walk(node.props.children, out);
  }
  return out;
}
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('gate: listPageParts draws nothing extra off desktop', () => {
  assert.deepEqual(listPageParts({ desktop: false, hasFilters: true, hasToolbar: true }), {
    frame: false,
    filterColumn: false,
    toolbarRow: false,
    inlineToolbar: true,
  });
  assert.deepEqual(listPageParts({ desktop: false, hasFilters: true, hasToolbar: false }).inlineToolbar, false);
  assert.deepEqual(listPageParts({ desktop: true, hasFilters: true, hasToolbar: true }), {
    frame: true,
    filterColumn: true,
    toolbarRow: true,
    inlineToolbar: false,
  });
  assert.deepEqual(listPageParts({ desktop: true, hasFilters: false, hasToolbar: false }), {
    frame: true,
    filterColumn: false,
    toolbarRow: false,
    inlineToolbar: false,
  });
  assert.equal(segmentedTabsMode(false), 'pills');
  assert.equal(segmentedTabsMode(true), 'segmented');
  assert.equal(segmentedTabLabel({ label: 'Open', count: 3 }), 'Open, 3');
  assert.equal(segmentedTabLabel({ label: 'Open', count: 0 }), 'Open, 0');
  assert.equal(segmentedTabLabel({ label: 'Done' }), 'Done');
});

test('phone: ListPage is the toolbar inline, then the children, and never the filters', () => {
  lp.layout = { desktop: false };
  const el = ListPage({ children: grid, toolbar: { left: tabs, right: sort }, filters: filterBox });
  assert.equal(el.type, React.Fragment);
  assert.deepEqual(el.props.children, [tabs, sort, grid]);
  assert.equal(walk(el).includes(filterBox), false);
  assert.equal(walk(el).some((n) => n.type === 'ScrollView'), false);
});

test('phone: ListPage with only children hands them back untouched', () => {
  lp.layout = { desktop: false };
  const el = ListPage({ children: grid });
  assert.equal(el.type, React.Fragment);
  assert.deepEqual(el.props.children, [null, null, grid]);
});

test('desktop: ListPage centres 1760, puts the 240 filter card left and the toolbar above the grid', () => {
  lp.layout = { desktop: true };
  const el = ListPage({
    children: grid,
    toolbar: { left: tabs, right: sort },
    filters: filterBox,
    scrollProps: { testID: 'list' },
  });
  assert.equal(el.type, 'ScrollView');
  assert.equal(el.props.testID, 'list');
  const nodes = walk(el);
  const page = nodes.find((n) => n.props.nativeID === 'listPage');
  assert.equal(flat(page.props.style).maxWidth, LIST_MAX);
  assert.equal(LIST_MAX, 1760);
  assert.equal(flat(page.props.style).alignSelf, 'center');
  assert.equal(flat(page.props.style).flexDirection, 'row');
  const [filterCol, main] = page.props.children;
  assert.equal(filterCol.props.nativeID, 'listPage-filters');
  const fs = flat(filterCol.props.style);
  assert.equal(fs.width, FILTER_WIDTH);
  assert.equal(FILTER_WIDTH, 240);
  assert.equal(fs.borderWidth, 1);
  assert.equal(fs.borderColor, 'LINE');
  assert.equal(fs.borderRadius, 18);
  assert.equal(fs.position, 'sticky');
  assert.equal(filterCol.props.children, filterBox);
  assert.equal(main.props.nativeID, 'listPage-main');
  const [bar, body] = main.props.children;
  assert.equal(bar.props.nativeID, 'listPage-toolbar');
  assert.ok(walk(bar).includes(tabs));
  assert.ok(walk(bar).includes(sort));
  assert.equal(body, grid);
});

test('desktop: no filters, no toolbar, no columns for them', () => {
  lp.layout = { desktop: true };
  const nodes = walk(ListPage({ children: grid }));
  assert.equal(nodes.some((n) => n.props.nativeID === 'listPage-filters'), false);
  assert.equal(nodes.some((n) => n.props.nativeID === 'listPage-toolbar'), false);
  assert.ok(nodes.includes(grid));
});

test('desktop: scroll={false} leaves scrolling to the screen', () => {
  lp.layout = { desktop: true };
  const el = ListPage({ children: grid, scroll: false });
  assert.equal(el.type, 'View');
  assert.equal(walk(el).some((n) => n.type === 'ScrollView'), false);
  assert.ok(walk(el).includes(grid));
});

const tabList = [
  { key: 'open', label: 'Open', count: 3 },
  { key: 'done', label: 'Done' },
];

test('phone: SegmentedTabs is a scrolling row of Pills, the chosen one active', () => {
  lp.layout = { desktop: false };
  const picked = [];
  const el = SegmentedTabs({ tabs: tabList, value: 'done', onChange: (k) => picked.push(k) });
  assert.equal(el.type, 'ScrollView');
  assert.equal(el.props.horizontal, true);
  const pills = el.props.children;
  assert.equal(pills.length, 2);
  for (const p of pills) assert.equal(p.type, PillStub);
  assert.deepEqual(
    pills.map((p) => [p.props.label, p.props.count, p.props.active]),
    [
      ['Open', 3, false],
      ['Done', undefined, true],
    ],
  );
  pills[0].props.onPress();
  assert.deepEqual(picked, ['open']);
});

test('desktop: SegmentedTabs is one segmented track with tab roles and count badges', () => {
  lp.layout = { desktop: true };
  const picked = [];
  const el = SegmentedTabs({ tabs: tabList, value: 'open', onChange: (k) => picked.push(k) });
  assert.equal(el.props.nativeID, 'segmentedTabs');
  assert.equal(el.props.accessibilityRole, 'tablist');
  assert.equal(flat(el.props.style).backgroundColor, 'SURFACE2');
  const nodes = walk(el);
  assert.equal(nodes.some((n) => n.type === PillStub), false);
  const buttons = nodes.filter((n) => n.type === 'Pressable');
  assert.equal(buttons.length, 2);
  assert.deepEqual(
    buttons.map((b) => [b.props.accessibilityRole, b.props.accessibilityLabel, b.props.accessibilityState.selected]),
    [
      ['tab', 'Open, 3', true],
      ['tab', 'Done', false],
    ],
  );
  assert.equal(flat(buttons[0].props.style).backgroundColor, 'SURFACE');
  assert.equal(flat(buttons[1].props.style).backgroundColor, 'transparent');
  const texts = nodes.filter((n) => n.type === 'Text').map((n) => n.props.children);
  assert.deepEqual(texts, ['Open', 3, 'Done']);
  buttons[1].props.onPress();
  assert.deepEqual(picked, ['done']);
});
