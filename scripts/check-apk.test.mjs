// Tests for the APK check (plan task 2.18 part G, hole H75). Run: node --test scripts/check-apk.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkApk, checkManifest, parseXmlTree } from './check-apk.mjs';

// The shape `aapt dump xmltree` prints, cut down from the 22 Nov 2026 staging build.
const good = `N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    A: package="com.taskdrop.app" (Raw: "com.taskdrop.app")
    E: application (line=125)
      A: android:name(0x01010003)="com.taskdrop.app.MainApplication" (Raw: "com.taskdrop.app.MainApplication")
      A: android:allowBackup(0x01010280)=(type 0x12)0x0
      A: android:fullBackupContent(0x010104eb)=@0x7f15000b
      E: meta-data (line=138)
        A: android:name(0x01010003)="some.key" (Raw: "some.key")
        A: android:value(0x01010024)="VALUE_NEVER_PRINTED" (Raw: "VALUE_NEVER_PRINTED")
      E: activity (line=169)
        A: android:name(0x01010003)="com.taskdrop.app.MainActivity" (Raw: "com.taskdrop.app.MainActivity")
        A: android:exported(0x01010010)=(type 0x12)0xffffffff
        E: intent-filter (line=177)
          E: action (line=178)
            A: android:name(0x01010003)="android.intent.action.MAIN" (Raw: "android.intent.action.MAIN")
        E: intent-filter (line=182)
          E: action (line=183)
            A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
          E: data (line=188)
            A: android:scheme(0x01010027)="taskdrop" (Raw: "taskdrop")
      E: service (line=196)
        A: android:name(0x01010003)="com.google.firebase.components.ComponentDiscoveryService" (Raw: "x")
        A: android:exported(0x01010010)=(type 0x12)0x0
      E: receiver (line=499)
        A: android:name(0x01010003)="com.google.firebase.iid.FirebaseInstanceIdReceiver" (Raw: "x")
        A: android:permission(0x01010006)="com.google.android.c2dm.permission.SEND" (Raw: "x")
        A: android:exported(0x01010010)=(type 0x12)0xffffffff
`;

const withApp = (attrs, body = '') =>
  good.replace('      A: android:allowBackup(0x01010280)=(type 0x12)0x0\n', attrs).replace('      E: service (line=196)', body + '      E: service (line=196)');

test('the parser reads names, flags and nesting', () => {
  const app = parseXmlTree(good).children[0].children[0];
  assert.equal(app.tag, 'application');
  assert.equal(app.attrs.allowBackup, '0x0');
  const main = app.children.find((c) => c.tag === 'activity');
  assert.equal(main.attrs.name, 'com.taskdrop.app.MainActivity');
  assert.equal(main.attrs.exported, '0xffffffff');
  assert.equal(main.children[1].children[1].attrs.scheme, 'taskdrop');
});

test('the staging build shape passes', () => {
  assert.deepEqual(checkManifest(good), []);
});

test('debuggable, test-only, backups and plain http each fail', () => {
  const p = checkManifest(withApp(
    '      A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff\n      A: android:testOnly(0x01010272)=(type 0x12)0xffffffff\n      A: android:usesCleartextTraffic(0x010104ec)=(type 0x12)0xffffffff\n'));
  assert.equal(p.length, 4);
  assert.match(p.join('\n'), /debuggable/);
  assert.match(p.join('\n'), /test-only/);
  assert.match(p.join('\n'), /allows backups/);
  assert.match(p.join('\n'), /plain-http/);
});

test('an exported component with no permission fails unless it is on the list', () => {
  const body = `      E: provider (line=300)
        A: android:name(0x01010003)="com.example.OpenProvider" (Raw: "x")
        A: android:exported(0x01010010)=(type 0x12)0xffffffff
      E: provider (line=310)
        A: android:name(0x01010003)="com.example.GuardedProvider" (Raw: "x")
        A: android:exported(0x01010010)=(type 0x12)0xffffffff
        A: android:readPermission(0x01010007)="com.example.READ" (Raw: "x")
`;
  const p = checkManifest(withApp('      A: android:allowBackup(0x01010280)=(type 0x12)0x0\n', body));
  assert.equal(p.length, 1);
  assert.match(p[0], /provider com\.example\.OpenProvider can be started by any app/);
});

test('an unverified https link and an unknown scheme fail; a verified https link passes', () => {
  const body = `      E: activity (line=400)
        A: android:name(0x01010003)="com.example.LinkActivity" (Raw: "x")
        A: android:exported(0x01010010)=(type 0x12)0x0
        E: intent-filter (line=401)
          E: action (line=402)
            A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "x")
          E: data (line=403)
            A: android:scheme(0x01010027)="https" (Raw: "https")
          E: data (line=404)
            A: android:scheme(0x01010027)="other" (Raw: "other")
        E: intent-filter (line=405)
          A: android:autoVerify(0x010104ee)=(type 0x12)0xffffffff
          E: action (line=406)
            A: android:name(0x01010003)="android.intent.action.VIEW" (Raw: "x")
          E: data (line=407)
            A: android:scheme(0x01010027)="https" (Raw: "https")
`;
  const p = checkManifest(withApp('      A: android:allowBackup(0x01010280)=(type 0x12)0x0\n', body));
  assert.equal(p.length, 2, p.join('\n'));
  assert.match(p[0], /https links without autoVerify/);
  assert.match(p[1], /scheme "other"/);
});

test('no problem sentence carries a meta-data value', () => {
  const p = checkManifest(withApp('      A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff\n'));
  assert.ok(p.length > 0);
  assert.ok(!p.join('\n').includes('VALUE_NEVER_PRINTED'));
});

test('a missing APK fails instead of passing', () => {
  const r = checkApk('no-such-file.apk');
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /no APK there/);
  assert.equal(checkApk(undefined).problems.length, 1);
});
