import React, { useState } from 'react';
import { post } from '../useWatch.js';

const RISK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
function Risk({ risk }) { return <span className={`pill ${risk}`}>{RISK_LABEL[risk]}</span>; }

export default function WindowsPanel({ data }) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [q, setQ] = useState('');
  const rows = data.windows.filter((w) =>
    (!onlyFlagged || w.flag || w.topmost || w.affinity || w.confidential) &&
    `${w.title} ${w.proc} ${w.path || ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <input placeholder="Filter by title, process or path…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only notable</label>
        <span className="muted">{rows.length} windows · top of the stack first</span>
      </div>
      <div className="list">
        {rows.map((w) => (
          <article key={w.hwnd} className={`row ${w.hwnd === data.fg ? 'active' : ''} ${w.flag ? w.flag.risk : ''} ${w.confidential ? 'secret' : ''}`}>
            <div className="main">
              <div className="title">
                {w.hwnd === data.fg && <span className="pill fg">Focused</span>}
                {w.title || <em>Untitled</em>}
              </div>
              <div className="sub">{w.proc}.exe · PID {w.pid} · {w.w}×{w.h}{w.path ? ` · ${w.path}` : ''}</div>
              <div className="tags">
                {w.flag && <><Risk risk={w.flag.risk} /><span className="tag">{w.flag.label}</span></>}
                {w.confidential && data.guard.shieldOn && <span className="tag ok">open</span>}
                {w.confidential && data.guard.shieldOn && w.topmost && !w.minimized && <span className="tag ok">on top</span>}
                {w.confidential && data.guard.shieldOn && w.captureHide === 'ok' && <span className="tag ok">no capture</span>}
                {w.confidential && data.guard.shieldOn && w.captureHide === 'refused' && <span className="tag warn">capture-hide refused</span>}
                {!w.confidential && w.topmost && <span className="tag warn">always on top</span>}
                {w.clickThrough && <span className="tag warn">click-through overlay</span>}
                {!w.confidential && w.affinity !== 0 && <span className="tag">hidden from screen capture</span>}
                {w.minimized && <span className="tag">minimized</span>}
                {w.confidential && <span className="tag conf" title={w.confWhy}>confidential{w.confWhy ? ` · ${w.confWhy}` : ''}</span>}
                {w.mark === 'public' && <span className="tag">non-confidential until the title changes</span>}
              </div>
            </div>
            <div className="actions">
              <button type="button" onClick={() => post('/api/window/focus', { hwnd: w.hwnd })}>Bring to front</button>
              <button type="button" className="ghost" onClick={() => post(`/api/window/${w.topmost ? 'untopmost' : 'topmost'}`, { hwnd: w.hwnd })}>
                {w.topmost ? 'Unpin' : 'Pin on top'}
              </button>
              <button type="button" className="ghost" onClick={() => post('/api/window/minimize', { hwnd: w.hwnd })}>Minimize</button>
              {w.mark
                ? <button type="button" className="ghost" onClick={() => post('/api/mark', { hwnd: w.hwnd, mark: null })}>Reset mark</button>
                : w.confidential
                  ? <button type="button" className="ghost" title="Lets a guarded tool see this window until its title changes" onClick={() => post('/api/mark', { hwnd: w.hwnd, mark: 'public' })}>Not confidential</button>
                  : <button type="button" className="black" onClick={() => post('/api/mark', { hwnd: w.hwnd, mark: 'confidential' })}>Mark confidential</button>}
            </div>
          </article>
        ))}
        {!rows.length && <div className="empty">No windows match.</div>}
      </div>
    </>
  );
}
