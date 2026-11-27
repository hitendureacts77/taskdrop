#!/usr/bin/env node
/**
 * The Android app, opened like an attacker (plan task 2.18 part G, hole H75). Run it on every APK
 * before it goes to testers or the store (5.0d):
 *
 *   node scripts/check-apk.mjs path/to/app.apk
 *
 * It reads the BUILT app, not the source:
 * - the merged manifest (through `aapt dump xmltree`, from the Android SDK build-tools; set AAPT to
 *   its path if it is not found under ANDROID_HOME / ANDROID_SDK_ROOT / the default SDK folder):
 *     * not debuggable, not test-only, no backups, no plain-http traffic;
 *     * every component other apps can start is either on ALLOWED_EXPORTS or guarded by a permission;
 *     * the only link that opens the app is the `taskdrop://` scheme, and any https app link must be
 *       verified (autoVerify), so no other site can claim it;
 * - every file inside, with the same secret rules as scripts/scan-build.mjs (the App Check debug
 *   token of H56 is not a pattern: `apps/mobile/variant.cjs` refuses a production build that has it).
 *
 * It prints rule names and component names, never a matched value. Exit 0: nothing found.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFolders } from './scan-build.mjs';

/** Components another app may start without a permission, and why. */
export const ALLOWED_EXPORTS = {
  'com.taskdrop.app.MainActivity': 'the launcher icon and the taskdrop:// return link from Google sign-in (PKCE: a stolen code is useless)',
};
/** Custom link schemes the app answers. */
export const ALLOWED_SCHEMES = ['taskdrop'];

const TRUE = '0xffffffff';

/** Parses `aapt dump xmltree <apk> AndroidManifest.xml` output into elements with depth, tag and attributes. */
export function parseXmlTree(text) {
  const root = { tag: '#root', depth: -1, attrs: {}, children: [] };
  const stack = [root];
  for (const line of text.split(/\r?\n/)) {
    const depth = line.search(/\S/);
    const el = /^\s*E: ([\w-]+)/.exec(line);
    if (el) {
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const node = { tag: el[1], depth, attrs: {}, children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    const at = /^\s*A: (?:android:)?([\w]+)(?:\(0x[0-9a-f]+\))?=(?:"((?:[^"\\]|\\.)*)"|\(type 0x[0-9a-f]+\)(0x[0-9a-f]+)|(@0x[0-9a-f]+))/i.exec(line);
    if (at && stack.length > 1) stack[stack.length - 1].attrs[at[1]] = at[2] ?? at[3] ?? at[4];
  }
  return root;
}

function find(node, tag, out = []) {
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    find(c, tag, out);
  }
  return out;
}

/** Returns plain sentences for every problem in the manifest. Never includes a meta-data value. */
export function checkManifest(text) {
  const problems = [];
  const app = find(parseXmlTree(text), 'application')[0];
  if (!app) return ['no <application> in the manifest: is this an APK?'];
  if (app.attrs.debuggable === TRUE) problems.push('application is debuggable: anyone with the phone can read its data and attach a debugger');
  if (app.attrs.testOnly === TRUE) problems.push('application is test-only');
  if (app.attrs.allowBackup !== '0x0') problems.push('application allows backups (allowBackup is not false): the signed-in session could be copied off the phone');
  if (app.attrs.usesCleartextTraffic === TRUE) problems.push('application allows plain-http traffic (usesCleartextTraffic)');

  for (const kind of ['activity', 'activity-alias', 'service', 'receiver', 'provider']) {
    for (const c of find(app, kind)) {
      const name = c.attrs.name ?? '(no name)';
      const exported = c.attrs.exported === TRUE;
      const guarded = Boolean(c.attrs.permission || (kind === 'provider' && (c.attrs.readPermission || c.attrs.writePermission)));
      if (exported && !guarded && !ALLOWED_EXPORTS[name]) {
        problems.push(`${kind} ${name} can be started by any app and has no permission: guard it, or add it to ALLOWED_EXPORTS with the reason`);
      }
      for (const f of find(c, 'intent-filter')) {
        const actions = find(f, 'action').map((a) => a.attrs.name);
        if (!actions.includes('android.intent.action.VIEW')) continue;
        for (const d of find(f, 'data')) {
          const scheme = d.attrs.scheme;
          if (!scheme) continue;
          if (scheme === 'http' || scheme === 'https') {
            if (f.attrs.autoVerify !== TRUE) problems.push(`${name} opens ${scheme} links without autoVerify: any site could claim them`);
          } else if (!ALLOWED_SCHEMES.includes(scheme)) {
            problems.push(`${name} opens the link scheme "${scheme}", which is not on ALLOWED_SCHEMES`);
          }
        }
      }
    }
  }
  return problems;
}

function findAapt() {
  if (process.env.AAPT) return process.env.AAPT;
  const exe = process.platform === 'win32' ? 'aapt.exe' : 'aapt';
  const homes = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? join(homedir(), 'AppData', 'Local', 'Android', 'Sdk') : join(homedir(), 'Android', 'Sdk')].filter(Boolean);
  for (const h of homes) {
    const bt = join(h, 'build-tools');
    if (!existsSync(bt)) continue;
    const versions = readdirSync(bt).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) if (existsSync(join(bt, v, exe))) return join(bt, v, exe);
  }
  return null;
}

function unzip(apk, dir) {
  // `unzip` on Linux and macOS; Windows' own tar reads zip files.
  for (const [cmd, args] of [['unzip', ['-q', '-o', apk, '-d', dir]], ['tar', ['-xf', apk, '-C', dir]]]) {
    if (spawnSync(cmd, args, { stdio: 'ignore' }).status === 0) return true;
  }
  return false;
}

/** Checks one APK. Returns { problems, files }. */
export function checkApk(apk) {
  if (!apk || !existsSync(apk)) return { problems: [`${apk ?? '(none)'}: no APK there. Build first; a missing build fails.`], files: 0 };
  const aapt = findAapt();
  if (!aapt) return { problems: ['aapt not found: install the Android SDK build-tools, or set AAPT to its path'], files: 0 };
  const dump = spawnSync(aapt, ['dump', 'xmltree', apk, 'AndroidManifest.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (dump.status !== 0) return { problems: ['aapt could not read the manifest'], files: 0 };
  const problems = checkManifest(dump.stdout);
  const dir = mkdtempSync(join(tmpdir(), 'check-apk-'));
  try {
    if (!unzip(apk, dir)) return { problems: [...problems, 'could not unpack the APK (needs unzip or tar)'], files: 0 };
    const scan = scanFolders(['.'], dir); // paths in the report are inside the APK
    return { problems: [...problems, ...scan.problems], files: scan.files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apk = process.argv[2];
  const { problems, files } = checkApk(apk);
  if (problems.length) {
    console.error(`check-apk: STOP, ${problems.length} problem(s):`);
    for (const p of problems) console.error(` - ${p}`);
    process.exit(1);
  }
  console.log(`check-apk: manifest passed; ${files} file(s) inside scanned, no secret found`);
}
