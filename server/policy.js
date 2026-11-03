// Capture-control policy: which capture / remote-access tools may see which windows.
//
// Model
//   tools[label]  = 'allow' | 'guard' | 'block'
//       allow : the tool may see everything.
//       guard : the tool may run, but while it is running every *confidential* window is kept open,
//               pinned above other windows, and (when Windows allows) excluded from screenshots and screen share.
//               Non-confidential windows stay where they are.
//       block : the tool is terminated whenever it is detected.
//   apps[]        = { proc, mode: 'always' | 'titles' | 'never', patterns: [substring, ...] }
//       always : every window of this program is confidential (PDF reader, EMR client, ...)
//       titles : a window is confidential only if its title contains one of the patterns (browsers:
//                the window title is the active tab's title)
//       never  : explicitly public
//   Per-window overrides (session only, keyed by hwnd) beat the app rules. A "public" mark is bound to the title
//   the window had when you set it, so it lapses as soon as the title changes (e.g. you open another browser tab).
//
// Marking an app confidential asks Windows to leave that window out of screenshots and screen share
// (WDA_EXCLUDEFROMCAPTURE). Captures show whatever is behind it — not a black box. The window stays
// open and usable. For apps that refuse a direct call, Watchtower asks that process to apply the
// same flag (same approach as watchtower-my).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNATURES } from './signatures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const POLICY_FILE = process.env.WATCHTOWER_POLICY || path.join(__dirname, 'data', 'policy.json');

export const MODES = ['allow', 'guard', 'block'];
export const APP_MODES = ['always', 'titles', 'never'];
const MAX_APPS = 100, MAX_PATTERNS = 50, MAX_LEN = 120;

// Tools that sit idle in the background all day (GPU overlays, Game Bar) would shield constantly, so they
// default to allow; everything that can actually see or stream the screen defaults to guard.
const ALWAYS_ON_BACKGROUND = /game bar|nvidia/i;
export function defaultModeFor(sig) {
  // Tivazo sits in the background and takes screenshots all day. Guard is the point of this desk:
  // confidential windows stay open and are kept out of those shots when Windows allows it.
  if (sig.label === 'Tivazo') return 'guard';
  if (ALWAYS_ON_BACKGROUND.test(sig.label)) return 'allow';
  if (['remote-access', 'screen-capture', 'stalkerware'].includes(sig.category)) return 'guard';
  return 'allow'; // other employee-monitoring agents, collaboration apps: shown, but not touched until you opt in
}

export function toolCatalog() {
  return SIGNATURES.map((s) => ({ label: s.label, category: s.category, risk: s.risk, defaultMode: defaultModeFor(s) }));
}

export const normProc = (s) => String(s || '').trim().toLowerCase().replace(/\.exe$/i, '').replace(/\s+/g, '');
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, MAX_LEN);

// Same product, different process names Windows may report.
const ALIAS_GROUPS = [
  ['whatsapp', 'whatsappdesktop'],
  ['chrome', 'chromium', 'chrome_proxy'],
  ['msedge', 'msedgewebview2'],
  ['code', 'code-insiders'],
  ['slack', 'slack-update'],
  ['teams', 'ms-teams', 'msteams'],
];
export function procAliases(proc) {
  const p = normProc(proc);
  if (!p) return [];
  for (const g of ALIAS_GROUPS) if (g.includes(p)) return [...g];
  return [p];
}
export function sameApp(a, b) {
  const A = procAliases(a), B = procAliases(b);
  return A.some((x) => B.includes(x));
}
export function isConfidentialProc(proc, policy) {
  const keys = new Set(procAliases(proc));
  return policy.apps.some((a) => a.mode === 'always' && (keys.has(a.proc) || sameApp(a.proc, proc)));
}

export function defaultPolicy() {
  return {
    enabled: true,   // master switch for the guard
    strict: true,    // guard while the tool's process is running at all; off = only while it has a visible window
    apps: [],
    tools: Object.fromEntries(toolCatalog().map((t) => [t.label, t.defaultMode])),
  };
}

// Accepts untrusted input, returns a valid policy (unknown keys dropped, bad values replaced by current/default).
export function sanitize(input, base = defaultPolicy()) {
  const out = { enabled: base.enabled, strict: base.strict, apps: base.apps, tools: { ...base.tools } };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.strict === 'boolean') out.strict = input.strict;
  if (input.tools && typeof input.tools === 'object') {
    const known = new Set(SIGNATURES.map((s) => s.label));
    for (const [label, mode] of Object.entries(input.tools)) {
      if (known.has(label) && MODES.includes(mode)) out.tools[label] = mode;
    }
  }
  if (Array.isArray(input.apps)) {
    const seen = new Set();
    out.apps = [];
    for (const a of input.apps.slice(0, MAX_APPS)) {
      const proc = normProc(clean(a?.proc));
      if (!proc || seen.has(proc) || !APP_MODES.includes(a?.mode)) continue;
      seen.add(proc);
      const patterns = (Array.isArray(a.patterns) ? a.patterns : [])
        .map((p) => clean(p).toLowerCase()).filter(Boolean).slice(0, MAX_PATTERNS);
      out.apps.push({ proc, mode: a.mode, patterns: [...new Set(patterns)] });
    }
  }
  return out;
}

export function loadPolicy(file = POLICY_FILE) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return defaultPolicy(); }
}
export function savePolicy(p, file = POLICY_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, file);
}

// ---- evaluation (pure) ----

// True when Windows reports see-through capture exclusion. WDA_MONITOR (1) is a black box — not success.
export const captureHidden = (affinity) => affinity === 17; // WDA_EXCLUDEFROMCAPTURE

export function isSelfWindow(w) {
  const t = String(w?.title || '').trim();
  const p = String(w?.proc || '').toLowerCase();
  if (/capture cover/i.test(t)) return true;
  return (p === 'electron' || p === 'watchtower') && /^watchtower$/i.test(t);
}

// Is this window confidential? Returns { confidential, why }.
//   overrides: hwnd -> { mark: 'confidential' | 'public', title }
export function windowStatus(w, policy, overrides = {}) {
  const ov = overrides[w.hwnd];
  if (ov?.mark === 'confidential') return { confidential: true, why: 'marked confidential by you', mark: 'confidential' };
  if (ov?.mark === 'public' && ov.title === w.title) return { confidential: false, why: 'marked non-confidential by you', mark: 'public' };
  const keys = procAliases(w.proc);
  const rule = policy.apps.find((a) => keys.includes(a.proc) || sameApp(a.proc, w.proc));
  if (!rule || rule.mode === 'never') return { confidential: false, why: null, mark: null };
  if (rule.mode === 'always') return { confidential: true, why: `${rule.proc} is a confidential app`, mark: 'confidential' };
  const t = String(w.title || '').toLowerCase();
  const hit = rule.patterns.find((p) => t.includes(p));
  return hit ? { confidential: true, why: `title contains "${hit}"`, mark: 'confidential' } : { confidential: false, why: null, mark: null };
}

/** One row per app for the desk UI — confidential comes from saved policy, not a fleeting window flag. */
export function buildDesk(windows = [], policy, fg = 0) {
  const by = new Map();
  for (const w of windows) {
    if (isSelfWindow(w)) continue;
    const key = normProc(w.proc);
    if (!key) continue;
    const marked = isConfidentialProc(key, policy);
    if (!w.title && !marked) continue;
    if (w.toolWindow && !marked) continue;
    let row = by.get(key);
    if (!row) {
      row = {
        id: key,
        proc: key,
        title: w.title || `${key}.exe`,
        hwnd: w.hwnd,
        count: 0,
        minimized: true,
        confidential: marked,
        captureHide: null,
      };
      by.set(key, row);
    }
    row.count += 1;
    row.confidential = marked;
    if (w.hwnd === fg && w.title) row.title = w.title;
    else if (w.title && (!row.title || row.title.endsWith('.exe'))) row.title = w.title;
    if (!w.minimized) row.minimized = false;
    if (marked) {
      if (w.captureHide === 'refused') row.captureHide = 'refused';
      else if (captureHidden(w.affinity) || w.captureHide === 'ok') {
        if (row.captureHide !== 'refused') row.captureHide = 'ok';
      } else if (!row.captureHide) row.captureHide = 'pending';
    } else row.captureHide = null;
  }
  return [...by.values()].sort((a, b) => Number(b.confidential) - Number(a.confidential) || a.title.localeCompare(b.title));
}

// Which guarded/blocked tools are active right now?
//   suspects : latest scan (processes + services)   windows : latest window tick (each has .flag from classify)
export function activeTools({ suspects = [], windows = [] }, policy) {
  const found = new Map(); // pid -> { label, pid, name, hasWindow, kind }
  const winPids = new Set(windows.filter((w) => !w.minimized).map((w) => w.pid)); // has an on-screen window
  for (const s of suspects) {
    if (s.kind !== 'process') continue;
    found.set(s.pid, { label: s.label, pid: s.pid, name: s.name, hasWindow: winPids.has(s.pid), kind: 'process' });
  }
  // windows are seen every 0.7 s, scans only every 10 s: a freshly launched tool shows up here first
  for (const w of windows) {
    if (w.flag && !found.has(w.pid)) found.set(w.pid, { label: w.flag.label, pid: w.pid, name: `${w.proc}.exe`, hasWindow: true, kind: 'window' });
  }
  return [...found.values()].filter((t) => policy.tools[t.label] === 'guard' || policy.tools[t.label] === 'block');
}

export function evaluate({ windows, suspects, policy, overrides = {}, manual = false, pausedUntil = 0, now = Date.now(), skipCapture = new Set() }) {
  const status = new Map();
  for (const w of windows) status.set(w.hwnd, windowStatus(w, policy, overrides));
  const paused = pausedUntil > now;
  const tools = policy.enabled ? activeTools({ suspects, windows }, policy) : [];
  const guards = tools.filter((t) => policy.tools[t.label] === 'guard' && (policy.strict || t.hasWindow));
  const blocks = tools.filter((t) => policy.tools[t.label] === 'block');
  // Marked apps stay protected whenever the guard is on — Tivazo does not have to be detected first.
  const shieldOn = policy.enabled && !paused;
  const toShield = shieldOn
    ? windows.filter((w) => {
        if (!status.get(w.hwnd).confidential || isSelfWindow(w)) return false;
        const hidden = captureHidden(w.affinity);
        if (w.topmost) return true; // strip leftover always-on-top so stacking stays normal
        if (hidden || skipCapture.has(w.hwnd)) return false;
        return true;
      }).map((w) => ({ hwnd: w.hwnd, proc: w.proc, title: w.title, why: status.get(w.hwnd).why }))
    : [];
  return { status, guards, blocks, paused, shieldOn, toShield };
}
