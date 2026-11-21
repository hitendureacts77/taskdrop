// FormPage (docs/design/desktop-web/PLAN.md, package 2): off desktop every piece
// must hand back exactly what a screen rendered before; on desktop it draws the card.
// The component is compiled with TypeScript and its app imports are swapped for
// small stand-ins, so the test needs no React Native renderer: each piece is called
// as a function and the element tree it returns is inspected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React from 'react';

const require = createRequire(import.meta.url);

function KeyboardScrollViewStub() {
  return null;
}
const fp = {
  layout: { desktop: false },
  theme: { colors: { surface: 'SURFACE', line: 'LINE', ink: 'INK', muted: 'MUTED' }, radius: { lg: 18 } },
  KeyboardScrollView: KeyboardScrollViewStub,
};
globalThis.__formPageTest = fp;

const stubs = {
  'react-native': "export const View = 'View'; export const Text = 'Text'; export const ScrollView = 'ScrollView';",
  '../lib/layout': 'export const useLayout = () => globalThis.__formPageTest.layout;',
  '../providers/ThemeProvider': 'export const useTheme = () => globalThis.__formPageTest.theme;',
  './KeyboardScrollView': 'export const KeyboardScrollView = globalThis.__formPageTest.KeyboardScrollView;',
  './primitives': 'export const tx = (fontWeight, fontSize, color, extra) => ({ fontWeight, fontSize, color, ...extra });',
};

const hooks = `
let ts; let stubs;
export async function initialize(data) {
  ts = (await import(data.ts)).default;
  stubs = data.stubs;
}
export async function resolve(specifier, context, next) {
  if (context.parentURL && context.parentURL.endsWith('/FormPage.tsx') && specifier in stubs) {
    return { url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (!url.endsWith('/FormPage.tsx')) return next(url, context);
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

const { FormPage, FormSection, FieldRow, ActionBar, ActionBarContext } = await import('./FormPage.tsx');

const kids = React.createElement('View', { key: 'k' }, 'fields');
const actions = React.createElement('View', { key: 'a' }, 'button');

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

test('phone: FormPage is the same KeyboardScrollView with the actions inline', () => {
  fp.layout = { desktop: false };
  const scrollProps = { hugContent: true, style: { flex: 1 }, contentContainerStyle: { paddingHorizontal: 20 } };
  const el = FormPage({ children: kids, actions, scrollProps });
  assert.equal(el.type, React.Fragment);
  const [scroll, pinned] = el.props.children;
  assert.equal(scroll.type, KeyboardScrollViewStub);
  assert.deepEqual({ ...scroll.props, children: undefined }, { ...scrollProps, children: undefined });
  assert.deepEqual(scroll.props.children, [kids, actions]);
  assert.equal(pinned, null);
});

test('phone: FormPage pins the actions under the scroll when asked', () => {
  fp.layout = { desktop: false };
  const el = FormPage({ children: kids, actions, phoneActions: 'pinned' });
  const [scroll, pinned] = el.props.children;
  assert.equal(scroll.type, KeyboardScrollViewStub);
  assert.deepEqual(scroll.props.children, [kids, null]);
  assert.equal(pinned, actions);
});

test('phone: FormSection, FieldRow and ActionBar hand back their children untouched', () => {
  fp.layout = { desktop: false };
  const section = FormSection({ title: 'Skills', hint: 'Up to 8', children: kids });
  assert.equal(section.type, React.Fragment);
  assert.equal(section.props.children, kids);
  const row = FieldRow({ children: [kids, actions] });
  assert.equal(row.type, React.Fragment);
  assert.deepEqual(row.props.children, [kids, actions]);
  const hint = React.createElement('Text', null, 'hint');
  const bar = ActionBar({ hint, children: actions });
  assert.equal(bar.type, React.Fragment);
  assert.deepEqual(bar.props.children, [actions, hint]);
  assert.equal(walk(bar).some((n) => n.type === ActionBarContext.Provider), false);
});

test('desktop: FormPage draws the 720 card with the actions, and the 320 aside beside it', () => {
  fp.layout = { desktop: true };
  const aside = React.createElement('View', null, 'preview');
  const el = FormPage({ children: kids, actions, aside, scrollProps: { hugContent: true, testID: 'form' } });
  assert.equal(el.type, 'ScrollView');
  assert.equal(el.props.testID, 'form');
  const nodes = walk(el);
  const card = nodes.find((n) => n.props.nativeID === 'formPage-card');
  assert.ok(card);
  const style = flat(card.props.style);
  assert.equal(style.maxWidth, 720);
  assert.equal(style.backgroundColor, 'SURFACE');
  assert.equal(style.borderColor, 'LINE');
  assert.equal(style.borderRadius, 18);
  assert.deepEqual(card.props.children, [kids, actions]);
  const side = nodes.find((n) => n.props.nativeID === 'formPage-aside');
  assert.equal(flat(side.props.style).width, 320);
  assert.equal(side.props.children, aside);
  assert.equal(nodes.some((n) => n.type === KeyboardScrollViewStub), false);
});

test('desktop: no aside, no aside column', () => {
  fp.layout = { desktop: true };
  const nodes = walk(FormPage({ children: kids }));
  assert.equal(nodes.some((n) => n.props.nativeID === 'formPage-aside'), false);
});

test('desktop: FormSection titles, the side column and the first section', () => {
  fp.layout = { desktop: true };
  const top = FormSection({ title: 'Skills', hint: 'Up to 8', first: true, children: kids });
  assert.equal(flat(top.props.style).borderTopWidth, 0);
  const texts = walk(top).filter((n) => n.type === 'Text').map((n) => n.props.children);
  assert.deepEqual(texts, ['Skills', 'Up to 8']);
  const side = FormSection({ title: 'Bio', side: true, children: kids });
  assert.equal(flat(side.props.style).flexDirection, 'row');
  assert.equal(flat(side.props.style).borderTopColor, 'LINE');
  assert.ok(walk(side).some((n) => flat(n.props.style).width === 200));
});

test('desktop: FieldRow puts each field in an equal column', () => {
  fp.layout = { desktop: true };
  const row = FieldRow({ children: [kids, actions] });
  assert.equal(flat(row.props.style).flexDirection, 'row');
  assert.equal(row.props.children.length, 2);
  for (const cell of row.props.children) assert.equal(flat(cell.props.style).flex, 1);
});

test('desktop: ActionBar tells the buttons they are in the bar', () => {
  fp.layout = { desktop: true };
  const bar = ActionBar({ hint: 'You can change this later.', children: actions });
  const provider = walk(bar).find((n) => n.type === ActionBarContext.Provider);
  assert.equal(provider?.props.value, true);
  assert.ok(walk(provider).includes(actions));
  const hint = walk(bar).find((n) => n.type === 'Text');
  assert.equal(hint.props.children, 'You can change this later.');
  assert.equal(flat(hint.props.style).color, 'MUTED');
});
