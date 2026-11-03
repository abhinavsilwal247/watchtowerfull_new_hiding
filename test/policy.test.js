import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPolicy, sanitize, evaluate, windowStatus, buildDesk, sameApp, isConfidentialProc } from '../server/policy.js';
import { classify } from '../server/signatures.js';

const win = (o) => ({ hwnd: 1, title: '', pid: 10, proc: 'x', minimized: false, ...o });
const withFlag = (w) => ({ ...w, flag: classify({ name: w.proc, path: '' }) });
const anydeskScan = [{ kind: 'process', pid: 99, name: 'AnyDesk.exe', label: 'AnyDesk', category: 'remote-access', risk: 'medium' }];

function policyWith(apps, tools = {}) {
  return sanitize({ apps, tools });
}

test('guard: confidential app is shielded while AnyDesk is running, public app is left alone', () => {
  const p = policyWith([{ proc: 'AcroRd32.exe', mode: 'always' }]);
  const windows = [win({ hwnd: 1, proc: 'AcroRd32', title: 'chart.pdf' }), win({ hwnd: 2, proc: 'notepad', title: 'todo' })];
  const ev = evaluate({ windows, suspects: anydeskScan, policy: p });
  assert.deepEqual(ev.toShield.map((t) => t.hwnd), [1]);
  assert.equal(ev.shieldOn, true);
});

test('a marked confidential app is protected even when no capture tool is running', () => {
  const p = policyWith([{ proc: 'acrord32', mode: 'always' }]);
  const ev = evaluate({ windows: [win({ proc: 'AcroRd32' })], suspects: [], policy: p });
  assert.equal(ev.toShield.length, 1);
  assert.equal(ev.shieldOn, true);
});

test('browser: confidential only when the tab title matches; non-confidential stays visible to the tool', () => {
  const p = policyWith([{ proc: 'chrome', mode: 'titles', patterns: ['Patient', 'EMR'] }]);
  const secret = win({ hwnd: 1, proc: 'chrome', title: 'Patient portal - J. Doe - Chrome' });
  const harmless = win({ hwnd: 2, proc: 'chrome', title: 'Pharmacology lecture - YouTube - Chrome' });
  const ev = evaluate({ windows: [secret, harmless], suspects: anydeskScan, policy: p });
  assert.deepEqual(ev.toShield.map((t) => t.hwnd), [1]);
  assert.equal(ev.status.get(2).confidential, false);
});

test('per-window override beats app rules in both directions', () => {
  const p = policyWith([{ proc: 'chrome', mode: 'titles', patterns: ['patient'] }]);
  const a = win({ hwnd: 1, proc: 'chrome', title: 'patient list' });
  const b = win({ hwnd: 2, proc: 'chrome', title: 'news' });
  const ev = evaluate({ windows: [a, b], suspects: anydeskScan, policy: p, overrides: { 1: { mark: 'public', title: 'patient list' }, 2: { mark: 'confidential', title: 'news' } } });
  assert.deepEqual(ev.toShield.map((t) => t.hwnd), [2]);
});

test('a "public" mark lapses when the window title changes (browser tab switch); "confidential" marks do not', () => {
  const p = policyWith([{ proc: 'chrome', mode: 'titles', patterns: ['patient'] }]);
  const ov = { 1: { mark: 'public', title: 'Patient list - Chrome' }, 2: { mark: 'confidential', title: 'old title' } };
  const same = evaluate({ windows: [win({ hwnd: 1, proc: 'chrome', title: 'Patient list - Chrome' })], suspects: anydeskScan, policy: p, overrides: ov });
  assert.equal(same.toShield.length, 0);
  const switched = evaluate({ windows: [win({ hwnd: 1, proc: 'chrome', title: 'Patient record 77 - Chrome' }), win({ hwnd: 2, proc: 'notepad', title: 'new title' })], suspects: anydeskScan, policy: p, overrides: ov });
  assert.deepEqual(switched.toShield.map((t) => t.hwnd).sort(), [1, 2]);
});

test('a confidential window stays hidden from capture even if the tool is allowed; block is still reported', () => {
  const windows = [win({ proc: 'AcroRd32' })];
  const apps = [{ proc: 'acrord32', mode: 'always' }];
  const allow = evaluate({ windows, suspects: anydeskScan, policy: policyWith(apps, { AnyDesk: 'allow' }) });
  assert.equal(allow.toShield.length, 1); assert.equal(allow.blocks.length, 0);
  const block = evaluate({ windows, suspects: anydeskScan, policy: policyWith(apps, { AnyDesk: 'block' }) });
  assert.deepEqual(block.blocks.map((b) => b.pid), [99]);
  assert.equal(block.toShield.length, 1);
});

test('freshly launched tool is detected from its window before the next 10 s scan', () => {
  const p = policyWith([{ proc: 'acrord32', mode: 'always' }]);
  const windows = [win({ hwnd: 1, proc: 'AcroRd32' }), withFlag(win({ hwnd: 3, pid: 77, proc: 'AnyDesk', title: 'AnyDesk' }))];
  const ev = evaluate({ windows, suspects: [], policy: p });
  assert.deepEqual(ev.toShield.map((t) => t.hwnd), [1]);
});

test('a confidential taskbar app stays protected while a capture tool is only running in the background', () => {
  const p = sanitize({ strict: false, apps: [{ proc: 'acrord32', mode: 'always' }] });
  const windows = [win({ proc: 'AcroRd32' })];
  assert.equal(evaluate({ windows, suspects: anydeskScan, policy: p }).shieldOn, true);
  assert.equal(evaluate({ windows, suspects: anydeskScan, policy: p }).toShield.length, 1);
});

test('pause, master switch and manual privacy mode', () => {
  const p = policyWith([{ proc: 'acrord32', mode: 'always' }]);
  const windows = [win({ proc: 'AcroRd32' })];
  const now = 1_000_000;
  assert.equal(evaluate({ windows, suspects: anydeskScan, policy: p, pausedUntil: now + 5000, now }).toShield.length, 0);
  assert.equal(evaluate({ windows, suspects: anydeskScan, policy: { ...p, enabled: false } }).toShield.length, 0);
  assert.equal(evaluate({ windows, suspects: [], policy: p, manual: true }).toShield.length, 1);
});

test('already excluded windows are skipped; Watchtower itself is never shielded; topmost leftover is cleared', () => {
  const p = policyWith([{ proc: 'chrome', mode: 'always' }, { proc: 'electron', mode: 'always' }]);
  const windows = [
    win({ hwnd: 1, proc: 'chrome', title: 'x', affinity: 17 }),
    win({ hwnd: 2, proc: 'electron', title: 'Watchtower' }),
    win({ hwnd: 3, proc: 'chrome', title: 'y', topmost: true, affinity: 17 }),
  ];
  assert.deepEqual(evaluate({ windows, suspects: anydeskScan, policy: p }).toShield.map((t) => t.hwnd), [3]);
});

test('a minimized taskbar app stays protected after it is marked confidential', () => {
  const flag = classify({ name: 'Tivazo.exe', path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Tivazo\\Tivazo.exe' });
  assert.equal(flag.label, 'Tivazo');
  assert.equal(flag.category, 'employee-monitoring');
  const ev = evaluate({
    windows: [win({ hwnd: 7, proc: 'WhatsApp', title: 'WhatsApp', minimized: true })],
    suspects: [],
    policy: policyWith([{ proc: 'whatsapp', mode: 'always' }]),
  });
  assert.equal(ev.shieldOn, true);
  assert.deepEqual(ev.toShield.map((t) => t.hwnd), [7]);
});

test('sanitize drops junk: unknown tools, bad modes, duplicate/empty apps, control chars, huge lists', () => {
  const p = sanitize({
    tools: { AnyDesk: 'block', 'Not A Tool': 'block', TeamViewer: 'explode' },
    apps: [{ proc: ' Foo.EXE ', mode: 'titles', patterns: ['  A\u0000B ', '', 'a b'] }, { proc: 'foo', mode: 'always' }, { proc: '', mode: 'always' }, { proc: 'bar', mode: 'nope' }, null],
    enabled: 'yes',
  });
  assert.equal(p.tools.AnyDesk, 'block');
  assert.equal(p.tools['Not A Tool'], undefined);
  assert.equal(p.tools.TeamViewer, 'guard');
  assert.deepEqual(p.apps, [{ proc: 'foo', mode: 'titles', patterns: ['ab', 'a b'] }]);
  assert.equal(p.enabled, true);
});

test('defaults: remote-access/capture tools guard, idle GPU overlays and collaboration allow', () => {
  const t = defaultPolicy().tools;
  assert.equal(t.AnyDesk, 'guard'); assert.equal(t.TeamViewer, 'guard'); assert.equal(t['OBS Studio'], 'guard'); assert.equal(t.Tivazo, 'guard');
  assert.equal(t['Xbox Game Bar capture'], 'allow'); assert.equal(t['Screen-share capable app'], 'allow');
});

test('process aliases keep WhatsApp / Chrome confidential across name variants', () => {
  assert.equal(sameApp('WhatsApp', 'WhatsAppDesktop'), true);
  const p = policyWith([{ proc: 'whatsapp', mode: 'always' }]);
  assert.equal(isConfidentialProc('WhatsAppDesktop', p), true);
  const desk = buildDesk([
    win({ hwnd: 1, proc: 'WhatsAppDesktop', title: 'WhatsApp', captureHide: 'ok', affinity: 17 }),
    win({ hwnd: 2, proc: 'chrome', title: 'a', affinity: 0 }),
    win({ hwnd: 3, proc: 'chrome', title: 'b', affinity: 0 }),
  ], p, 1);
  const wa = desk.find((d) => d.proc.includes('whatsapp'));
  const ch = desk.find((d) => d.proc === 'chrome');
  assert.equal(wa.confidential, true);
  assert.equal(wa.captureHide, 'ok');
  assert.equal(ch.confidential, false);
  assert.equal(ch.count, 2);
});
