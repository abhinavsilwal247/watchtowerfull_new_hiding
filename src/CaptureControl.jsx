import React, { useMemo, useState } from 'react';
import { post } from './useWatch.js';

const MODE_HELP = {
  allow: 'May see everything.',
  guard: 'May run. Confidential windows stay open, jump to the top, and are left out of screenshots when Windows allows it.',
  block: 'Terminated whenever it is detected.',
};
const CATEGORY = {
  'remote-access': 'Remote access (AnyDesk, TeamViewer, …)',
  'screen-capture': 'Screenshot & screen recording',
  collaboration: 'Meeting apps that can share your screen',
  stalkerware: 'Spy apps & keyloggers',
  'employee-monitoring': 'Employer / monitoring agents',
};
const CATEGORY_ORDER = ['remote-access', 'screen-capture', 'collaboration', 'stalkerware', 'employee-monitoring'];

const savePolicy = (patch) => post('/api/policy', patch);

function Segmented({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={`${value === v ? 'on' : ''} ${v === 'block' ? 'danger' : ''}`} onClick={() => value !== v && onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

function GuardStatus({ data }) {
  const { guard, policy } = data;
  const left = guard.paused ? Math.max(0, Math.ceil((guard.pausedUntil - Date.now()) / 60000)) : 0;
  return (
    <div className="card">
      <p className="eyebrow">Shield</p>
      <h3>Guard</h3>
      <p className="muted">
        While Tivazo or any tool set to <b>Guard</b> is running, confidential windows stay open. Watchtower restores them,
        pins them above everything else, and asks Windows to leave them out of screenshots and screen share.
        They are never minimized. If Windows refuses capture-hide for an app it does not own, that window still stays open and on top,
        and the Focus log says so. Watchtower does not inject code into WhatsApp or any other app.
      </p>
      <div className="toolbar">
        <label><input type="checkbox" checked={policy.enabled} onChange={(e) => savePolicy({ enabled: e.target.checked })} /> Guard enabled</label>
        <label title="Off = only guard while the tool has a visible window (a background service alone does not trigger it)">
          <input type="checkbox" checked={policy.strict} onChange={(e) => savePolicy({ strict: e.target.checked })} /> Strict: guard whenever the tool is running
        </label>
      </div>
      <div className="toolbar">
        <button type="button" className={guard.manual ? 'black' : 'ghost'} onClick={() => post('/api/guard', { manual: !guard.manual })}>
          {guard.manual ? 'Privacy mode on — click to turn off' : 'Privacy mode: pin confidential windows now'}
        </button>
        {guard.paused
          ? <button type="button" className="ghost" onClick={() => post('/api/guard', { pauseMinutes: 0 })}>Resume guard ({left} min left)</button>
          : <button type="button" className="ghost" onClick={() => post('/api/guard', { pauseMinutes: 5 })}>Pause guard 5 min</button>}
        <span className={`pill ${guard.shieldOn ? 'fg' : 'low'}`}>
          {!policy.enabled ? 'guard off' : guard.paused ? 'paused' : guard.shieldOn ? `on top · ${guard.onTop} · no capture ${guard.noCapture}` : 'idle — nothing to guard against'}
        </span>
      </div>
      {guard.active.length > 0 && <div className="muted">Triggered by: {guard.active.map((a) => `${a.label} (${a.name})`).join(', ')}</div>}
    </div>
  );
}

function Tools({ data }) {
  const { policy, catalog } = data;
  const running = useMemo(() => {
    const set = new Set(data.suspects.map((s) => s.label));
    for (const w of data.windows) if (w.flag) set.add(w.flag.label);
    return set;
  }, [data.suspects, data.windows]);
  const [showAll, setShowAll] = useState(false);

  const setMode = (label, mode) => {
    if (mode === 'block' && !window.confirm(`Block "${label}"?\n\nWatchtower will terminate it every time it is detected, so it cannot be used for remote support or capture while Watchtower is running.`)) return;
    savePolicy({ tools: { [label]: mode } });
  };
  const groups = CATEGORY_ORDER.map((c) => [c, catalog.filter((t) => t.category === c)]).filter(([, l]) => l.length);
  return (
    <div className="card">
      <h3>Who may capture your screen</h3>
      <p className="muted">Pick what each tool is allowed to do. Detection is by signature, so renamed copies are not recognised — see the README.</p>
      {groups.map(([cat, list]) => {
        const hidden = !showAll && (cat === 'employee-monitoring' || cat === 'stalkerware');
        if (hidden && !list.some((t) => running.has(t.label) || policy.tools[t.label] !== t.defaultMode)) return null;
        return (
          <div key={cat} className="group">
            <div className="group-title">{CATEGORY[cat]}</div>
            {list.map((t) => (
              <div key={t.label} className="trow">
                <div className="main">
                  <span className="tname">{t.label}</span>
                  {running.has(t.label) && <span className="pill fg">running now</span>}
                  <div className="sub">{MODE_HELP[policy.tools[t.label]]}</div>
                </div>
                <Segmented value={policy.tools[t.label]} onChange={(m) => setMode(t.label, m)} options={[['allow', 'Allow'], ['guard', 'Guard'], ['block', 'Block']]} />
              </div>
            ))}
          </div>
        );
      })}
      <label className="muted"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Also list employer-monitoring and spy-app signatures</label>
    </div>
  );
}

function AppRule({ rule, onChange, onRemove }) {
  const [text, setText] = useState(rule.patterns.join(', '));
  const commit = () => onChange({ ...rule, patterns: text.split(',').map((s) => s.trim()).filter(Boolean) });
  return (
    <div className="trow">
      <div className="main">
        <span className="tname">{rule.proc}.exe</span>
        {rule.mode === 'titles' && (
          <input
            className="patterns" value={text} placeholder="confidential if title contains… (comma separated, e.g. patient, EMR, portal)"
            onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
        {rule.mode === 'titles' && !rule.patterns.length && <div className="sub warnText">No patterns yet — none of this app's windows are treated as confidential.</div>}
        {rule.mode === 'always' && <div className="sub">Every window of this app is confidential.</div>}
        {rule.mode === 'never' && <div className="sub">Never shielded.</div>}
      </div>
      <Segmented value={rule.mode} onChange={(mode) => onChange({ ...rule, mode })} options={[['always', 'Always'], ['titles', 'By title'], ['never', 'Never']]} />
      <button className="ghost" onClick={onRemove}>Remove</button>
    </div>
  );
}

function Apps({ data }) {
  const apps = data.policy.apps;
  const [manual, setManual] = useState('');
  const open = useMemo(() => {
    const have = new Set(apps.map((a) => a.proc));
    return [...new Set(data.windows.filter((w) => w.title).map((w) => w.proc.toLowerCase()))].filter((p) => !have.has(p)).sort();
  }, [data.windows, apps]);
  const add = (proc, mode = 'always') => {
    const p = proc.trim().toLowerCase().replace(/\.exe$/, '');
    if (p && !apps.some((a) => a.proc === p)) savePolicy({ apps: [...apps, { proc: p, mode, patterns: [] }] });
    setManual('');
  };
  const replace = (i, rule) => savePolicy({ apps: apps.map((a, j) => (j === i ? rule : a)) });
  return (
    <div className="card">
      <h3>What is confidential</h3>
      <p className="muted">
        <b>Always</b> suits a PDF reader or records app. For a <b>browser</b> use <b>By title</b>: a browser window's title is its active tab, so the window counts as
        confidential only while the tab matches one of your words — otherwise a Guard tool may keep watching it.
        You can also mark a single window on the Windows tab.
      </p>
      <div className="list">
        {apps.map((a, i) => <AppRule key={a.proc} rule={a} onChange={(r) => replace(i, r)} onRemove={() => savePolicy({ apps: apps.filter((_, j) => j !== i) })} />)}
        {!apps.length && <div className="empty">No confidential apps yet.</div>}
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">Add an app that is open now…</option>
          {open.map((p) => <option key={p} value={p}>{p}.exe</option>)}
        </select>
        <input placeholder="…or type a program name, e.g. AcroRd32" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(manual)} />
        <button onClick={() => add(manual)} disabled={!manual.trim()}>Add</button>
      </div>
      <p className="note">The Watchtower window itself is never pinned by the guard. WhatsApp is confidential by default. For a browser, use By title so only the client tab is shielded.</p>
    </div>
  );
}

export default function CaptureControl({ data }) {
  return (
    <div className="stack">
      <GuardStatus data={data} />
      <Tools data={data} />
      <Apps data={data} />
      <p className="note">
        Limits: this only works while Watchtower is running; it reacts within ~1 s, not instantly; it cannot stop a phone photographing the screen,
        hardware capture, or a tool it does not recognise. A tool that is running as a Windows service may restart itself after <i>Block</i>.
      </p>
    </div>
  );
}
