import express from 'express';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classify } from './signatures.js';
import { mockTick, mockScan, mockMinimize, mockRestore, mockKill, mockCaptureHide, mockCaptureShow } from './mock.js';
import { loadPolicy, savePolicy, sanitize, evaluate, captureHidden, buildDesk, toolCatalog, POLICY_FILE, normProc, procAliases, sameApp } from './policy.js';

const PIN = process.env.WATCHTOWER_PIN || '8998';
const sessions = new Set();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS = (f) => path.join(__dirname, 'ps', f);
const PORT = Number(process.env.PORT || 3001);
const HOST = '127.0.0.1'; // never expose this beyond the local machine
const mock = process.argv.includes('--mock') || process.platform !== 'win32';
if (mock && process.platform === 'win32') console.log('Mock mode requested.');
if (mock && process.platform !== 'win32') console.log('Not Windows: running with mock data.');

// ---------- state ----------
const state = {
  mock, fg: 0, idleMs: 0, windows: [], desk: [], events: [], suspects: [], scanAt: 0, awake: null,
  policy: null, catalog: toolCatalog(), guard: { enabled: true, manual: false, paused: false, pausedUntil: 0, shieldOn: false, active: [], blocking: [], shielded: 0 },
};

// ---------- capture-control policy ----------
const policyFile = mock ? POLICY_FILE.replace(/\.json$/, '.mock.json') : POLICY_FILE; // mock mode never touches your real policy
let policy = loadPolicy(policyFile);
state.policy = policy;
const overrides = {};          // hwnd -> { mark: 'confidential' | 'public', title }  (this session only)
let manualShield = false;      // "privacy mode": shield confidential windows regardless of what is running
let pausedUntil = 0;           // temporary pause of the guard
const lastShield = new Map();  // hwnd -> ms
const pinnedByGuard = new Set(); // hwnds we asked Windows to exclude from capture
const skipCapture = new Set();   // hwnds where capture-hide failed — don't spam
const captureNote = new Set();
const lastKill = new Map();    // pid  -> ms

const SAFE_EXE = /^[\w.\- ]{1,100}\.exe$/i;
function killTool(t) {
  // Match PID *and* image name so a recycled PID can never terminate an unrelated program.
  if (mock) { mockKill(t.pid); return Promise.resolve(); }
  return new Promise((resolve, reject) =>
    execFile('taskkill.exe', ['/F', '/FI', `PID eq ${t.pid}`, '/FI', `IMAGENAME eq ${t.name}`], (e) => (e ? reject(e) : resolve())));
}

// Runs after every window tick / scan / policy change: tags windows, shields confidential ones, blocks tools.
function enforce() {
  const now = Date.now();
  const live = new Set(state.windows.map((w) => String(w.hwnd)));
  for (const k of Object.keys(overrides)) if (!live.has(k)) delete overrides[k];

  const ev = evaluate({ windows: state.windows, suspects: state.suspects, policy, overrides, manual: manualShield, pausedUntil, now, skipCapture });
  for (const w of state.windows) {
    const s = ev.status.get(w.hwnd);
    w.confidential = s.confidential; w.confWhy = s.why; w.mark = s.mark;
    if (captureHidden(w.affinity)) w.captureHide = 'ok';
    else if (skipCapture.has(w.hwnd) && w.confidential) w.captureHide = 'refused';
    else if (pinnedByGuard.has(w.hwnd) && w.confidential) w.captureHide = 'pending';
    else w.captureHide = null;
  }
  state.desk = buildDesk(state.windows, policy, state.fg);
  state.policy = policy;

  let noCapture = 0, captureRefused = 0;
  if (ev.shieldOn) {
    for (const w of state.windows) {
      if (!w.confidential) continue;
      if (w.captureHide === 'ok') noCapture += 1;
      if (w.captureHide === 'refused') captureRefused += 1;
    }
  }
  const brief = (t) => ({ label: t.label, name: t.name, pid: t.pid });
  state.guard = {
    enabled: policy.enabled, manual: manualShield, paused: ev.paused, pausedUntil: ev.paused ? pausedUntil : 0, shieldOn: ev.shieldOn,
    active: ev.guards.map(brief), blocking: ev.blocks.map(brief),
    shielded: ev.shieldOn
      ? state.windows.filter((w) => w.confidential && (pinnedByGuard.has(w.hwnd) || captureHidden(w.affinity))).length
      : 0,
    noCapture, captureRefused,
  };

  // See-through only — screenshots show what is behind the private window, never a black box.
  if (!ev.shieldOn && pinnedByGuard.size) {
    const restore = [...pinnedByGuard];
    pinnedByGuard.clear();
    skipCapture.clear();
    captureNote.clear();
    runAction('release', restore).catch((e) => console.error('[shield]', e.message));
  }
  for (const w of state.windows) {
    if (!pinnedByGuard.has(w.hwnd)) continue;
    if (captureHidden(w.affinity)) { skipCapture.delete(w.hwnd); continue; }
    const raisedAt = lastShield.get(w.hwnd) || 0;
    if (raisedAt && now - raisedAt > 2000) {
      skipCapture.add(w.hwnd);
      if (!captureNote.has(w.hwnd)) {
        captureNote.add(w.hwnd);
        pushEvent({ ts: now, kind: 'shield', hwnd: w.hwnd, title: w.title || '(untitled)', proc: w.proc, note: 'Could not exclude from capture. Try running Watchtower as Administrator.' });
      }
    }
  }
  const fresh = ev.toShield.filter((t) => now - (lastShield.get(t.hwnd) || 0) > 2500);
  if (fresh.length) {
    const cause = manualShield && !ev.guards.length ? 'privacy mode' : (ev.guards.map((g) => g.label).join(', ') || 'guard');
    for (const t of fresh) {
      lastShield.set(t.hwnd, now);
      pinnedByGuard.add(t.hwnd);
      pushEvent({ ts: now, kind: 'shield', hwnd: t.hwnd, title: t.title || '(untitled)', proc: t.proc, note: `Excluded from capture — behind shows through (${t.why}) — ${cause}` });
    }
    runAction('nocapture', fresh.map((t) => t.hwnd)).catch((e) => console.error('[shield]', e.message));
  }
  for (const h of [...pinnedByGuard]) {
    if (!live.has(String(h))) { pinnedByGuard.delete(h); skipCapture.delete(h); captureNote.delete(h); }
  }
  // Drop pin when the app is no longer confidential
  for (const h of [...pinnedByGuard]) {
    const w = state.windows.find((x) => x.hwnd === h);
    if (w && !w.confidential) {
      pinnedByGuard.delete(h); skipCapture.delete(h); captureNote.delete(h);
      runAction('release', [h]).catch(() => {});
    }
  }
  for (const [h, t] of lastShield) if (now - t > 60000) lastShield.delete(h);
  for (const [k, t] of lastKill) if (now - t > 60000) lastKill.delete(k);

  // 2) block: terminate tools you set to "block"
  for (const t of ev.blocks) {
    if (!(t.pid > 4) || t.pid === process.pid || !SAFE_EXE.test(t.name) || now - (lastKill.get(t.pid) || 0) < 5000) continue;
    lastKill.set(t.pid, now);
    killTool(t).then(
      () => {
        lastKill.set(t.pid, Date.now() + 25000);
        pushEvent({ ts: Date.now(), kind: 'block', title: t.label, proc: t.name.replace(/\.exe$/i, ''), pid: t.pid, note: 'Blocked: process terminated' });
      },
      (e) => pushEvent({ ts: Date.now(), kind: 'block', title: t.label, proc: t.name.replace(/\.exe$/i, ''), pid: t.pid, note: `Could not terminate (try running as Administrator): ${String(e.message).split('\n')[0]}` }),
    );
  }
}
const MAX_EVENTS = 500;
let lastFg = null;
let eventId = 0;
const lastSeen = new Map(); // hwnd -> {title, proc}

function pushEvent(ev) {
  state.events.push({ id: ++eventId, ...ev });
  if (state.events.length > MAX_EVENTS) state.events.shift();
}

function onTick(tick) {
  const wins = tick.wins.map((w) => ({ ...w, flag: classify({ name: w.proc, path: w.path || '' }) }));
  state.windows = wins;
  state.fg = tick.fg;
  state.idleMs = tick.idleMs;

  // Focus-change log. If focus moved while you had no input for >2s, an app took focus on its own.
  if (lastFg !== null && tick.fg !== lastFg) {
    const w = wins.find((x) => x.hwnd === tick.fg);
    const prev = lastSeen.get(lastFg);
    pushEvent({
      ts: tick.t, kind: 'focus', hwnd: tick.fg, title: w?.title || '(no window)', proc: w?.proc || '?', pid: w?.pid,
      path: w?.path, prev: prev ? `${prev.proc} — ${prev.title}` : null, idleMs: tick.idleMs,
      selfActivated: tick.idleMs > 2000, flag: w?.flag || null,
    });
  }
  lastFg = tick.fg;
  for (const w of wins) lastSeen.set(w.hwnd, { title: w.title, proc: w.proc });

  // New window events for flagged / overlay windows
  for (const w of wins) {
    const key = `ov:${w.hwnd}`;
    if (!seenOverlay.has(key) && (w.flag?.risk === 'high' || (w.topmost && w.clickThrough && !w.title))) {
      seenOverlay.add(key);
      pushEvent({ ts: tick.t, kind: 'overlay', hwnd: w.hwnd, title: w.title || '(untitled overlay)', proc: w.proc, pid: w.pid, path: w.path, flag: w.flag, note: 'Topmost click-through overlay' });
    }
  }
  enforce();
}
const seenOverlay = new Set();

function onScan(scan) {
  const out = [];
  const byPid = new Map();
  for (const p of scan.procs || []) {
    const flag = classify({ name: p.name, path: p.path || '', cmd: p.cmd || '' });
    if (!flag) continue;
    byPid.set(p.pid, true);
    // a remote-access / capture tool with live outbound connections is more notable
    let risk = flag.risk;
    if (p.conns > 0 && flag.risk === 'low' && flag.category !== 'collaboration') risk = 'medium';
    out.push({ kind: 'process', pid: p.pid, ppid: p.ppid, name: p.name, path: p.path, cmd: p.cmd, conns: p.conns, remotes: p.remotes, ...flag, risk });
  }
  for (const s of scan.services || []) {
    if (byPid.has(s.pid)) continue;
    const flag = classify({ name: s.name, path: s.path || '', display: s.display });
    if (!flag) continue;
    out.push({ kind: 'service', pid: s.pid, name: s.name, display: s.display, path: s.path, conns: 0, remotes: [], ...flag });
  }
  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => order[a.risk] - order[b.risk] || a.name.localeCompare(b.name));
  state.suspects = out;
  state.scanAt = Date.now();
  enforce();
}

// ---------- data sources ----------
function startMonitor() {
  if (mock) { setInterval(() => onTick(mockTick()), 700); return; }
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS('monitor.ps1')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      try { onTick(JSON.parse(line)); } catch { /* partial line */ }
    }
  });
  ps.stderr.on('data', (d) => console.error('[monitor]', String(d).trim()));
  ps.on('exit', (c) => { console.error('monitor exited', c); setTimeout(startMonitor, 2000); });
  process.on('exit', () => ps.kill());
}

function runScan() {
  if (mock) { onScan(mockScan()); return; }
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS('scan.ps1')], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
    if (err) return console.error('[scan]', err.message);
    try { onScan(JSON.parse(stdout)); } catch (e) { console.error('[scan] bad json', e.message); }
  });
}

function runAction(op, hwnd) {
  const many = Array.isArray(hwnd);
  const ids = (many ? hwnd : [hwnd]).map(Number);
  if (mock) {
    for (const h of ids) {
      if (op === 'minimize') mockMinimize(h);
      else if (op === 'focus') mockRestore(h);
      else if (op === 'nocapture' || op === 'exclude' || op === 'raise') mockCaptureHide(h);
      else if (op === 'release') mockCaptureShow(h);
    }
    return Promise.resolve();
  }
  const target = many ? ['-Hwnds', ids.join(',')] : ['-Hwnd', String(ids[0])];
  return new Promise((resolve, reject) =>
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS('action.ps1'), '-Op', op, ...target], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (e) => (e ? reject(e) : resolve())));
}

let awakeProc = null;
function setAwake(on, display = true) {
  if (awakeProc) { awakeProc.kill(); awakeProc = null; }
  state.awake = null;
  if (!on) return;
  state.awake = { display, since: Date.now() };
  if (!mock) awakeProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS('awake.ps1'), '-Display', display ? '1' : '0'], { stdio: 'ignore' });
}
process.on('exit', () => awakeProc?.kill());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

// ---------- http ----------
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function pinMatches(pin) {
  const a = Buffer.from(String(pin));
  const b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setSessionCookie(res, token) {
  const value = token ? `wt=${token}; HttpOnly; SameSite=Strict; Path=/` : 'wt=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
  res.setHeader('Set-Cookie', value);
}

const app = express();
app.use(express.json());
// Same-machine only: reject cross-origin browser requests (blocks drive-by pages from controlling windows)
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return res.status(403).end();
  // Host check blocks DNS-rebinding (a hostile site resolving its own name to 127.0.0.1); the API can now terminate programs.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return res.status(403).end();
  next();
});
app.post('/api/unlock', (req, res) => {
  if (!pinMatches(req.body?.pin ?? '')) return res.status(401).json({ error: 'wrong pin' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  setSessionCookie(res, token);
  res.json({ ok: true });
});
app.get('/api/session', (req, res) => {
  if (!sessions.has(readCookie(req, 'wt'))) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});
app.post('/api/lock', (req, res) => {
  sessions.delete(readCookie(req, 'wt'));
  setSessionCookie(res, '');
  res.json({ ok: true });
});
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  if (!sessions.has(readCookie(req, 'wt'))) return res.status(401).json({ error: 'locked' });
  next();
});

const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
setInterval(() => {
  if (!clients.size) return;
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const c of clients) c.write(payload);
}, 700);

const num = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
app.post('/api/window/:op', async (req, res) => {
  const { op } = req.params;
  if (!['focus', 'topmost', 'untopmost', 'minimize'].includes(op) || !num(req.body?.hwnd)) return res.status(400).json({ error: 'bad request' });
  try { await runAction(op, Number(req.body.hwnd)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// ----- capture control -----
app.post('/api/policy', (req, res) => {
  policy = sanitize(req.body, policy);
  state.policy = policy;
  try { savePolicy(policy, policyFile); } catch (e) { console.error('[policy] save failed', e.message); return res.status(500).json({ error: 'could not save policy' }); }
  for (const t of lastShield.keys()) lastShield.delete(t); // apply new rules immediately
  enforce();
  res.json(policy);
});
app.post('/api/guard', (req, res) => {
  if (typeof req.body?.manual === 'boolean') { manualShield = req.body.manual; lastShield.clear(); }
  if (req.body?.pauseMinutes !== undefined) {
    const m = Math.min(Math.max(Number(req.body.pauseMinutes) || 0, 0), 120);
    pausedUntil = m > 0 ? Date.now() + m * 60000 : 0;
  }
  enforce();
  res.json(state.guard);
});
app.post('/api/mark', (req, res) => {
  const { hwnd, proc, mark } = req.body || {};
  if (proc) {
    const name = normProc(proc);
    if (!name || ![null, 'confidential'].includes(mark ?? null)) return res.status(400).json({ error: 'bad request' });
    const aliases = new Set(procAliases(name));
    // Drop every alias of this app so unmark always clears confidential
    let apps = policy.apps.filter((a) => !aliases.has(a.proc) && !sameApp(a.proc, name));
    if (mark === 'confidential') apps.push({ proc: name, mode: 'always', patterns: [] });
    policy = sanitize({ apps }, policy);
    state.policy = policy;
    try { savePolicy(policy, policyFile); }
    catch (e) { console.error('[policy] save failed', e.message); return res.status(500).json({ error: 'could not save' }); }
    const release = [];
    for (const w of state.windows) {
      if (!sameApp(w.proc, name)) continue;
      lastShield.delete(w.hwnd);
      skipCapture.delete(w.hwnd);
      captureNote.delete(w.hwnd);
      if (mark !== 'confidential' && pinnedByGuard.has(w.hwnd)) {
        pinnedByGuard.delete(w.hwnd);
        release.push(w.hwnd);
      }
    }
    if (release.length) runAction('release', release).catch(() => {});
    enforce();
    return res.json({ ok: true, confidential: mark === 'confidential', proc: name, desk: state.desk });
  }
  if (!num(hwnd) || ![null, 'confidential', 'public'].includes(mark ?? null)) return res.status(400).json({ error: 'bad request' });
  const w = state.windows.find((x) => x.hwnd === Number(hwnd));
  if (mark && w) overrides[Number(hwnd)] = { mark, title: w.title }; else delete overrides[Number(hwnd)];
  lastShield.delete(Number(hwnd));
  skipCapture.delete(Number(hwnd));
  captureNote.delete(Number(hwnd));
  enforce();
  res.json({ ok: true });
});
app.post('/api/awake', (req, res) => { setAwake(!!req.body?.on, req.body?.display !== false); res.json(state.awake); });
app.post('/api/scan', (req, res) => { runScan(); res.json({ ok: true }); });
app.post('/api/events/clear', (req, res) => { state.events = []; res.json({ ok: true }); });

const dist = process.env.WATCHTOWER_DIST || path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); }

app.listen(PORT, HOST, () => console.log(`Watchtower API on http://${HOST}:${PORT}${mock ? ' (mock data)' : ''}`));
startMonitor();
runScan();
setInterval(runScan, 10000);
