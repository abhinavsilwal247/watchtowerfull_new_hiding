import React, { useMemo, useState } from 'react';
import { post } from '../useWatch.js';

const RISK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
const fmtIdle = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
function Risk({ risk }) { return <span className={`pill ${risk}`}>{RISK_LABEL[risk]}</span>; }

export default function FocusLog({ data }) {
  const [onlySelf, setOnlySelf] = useState(false);
  const events = useMemo(
    () => [...data.events].reverse().filter((e) => !onlySelf || e.selfActivated || e.kind !== 'focus'),
    [data.events, onlySelf],
  );
  return (
    <>
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={onlySelf} onChange={(e) => setOnlySelf(e.target.checked)} /> Focus taken without my input, plus shield and block events</label>
        <button type="button" className="ghost" onClick={() => post('/api/events/clear')}>Clear log</button>
        <span className="muted">Self-activated means focus changed after 2 seconds with no keyboard or mouse input from you.</span>
      </div>
      <div className="list">
        {events.map((e) => (
          <article key={e.id} className={`row ${e.flag ? e.flag.risk : ''} ${e.selfActivated ? 'self' : ''}`}>
            <div className="time">{fmtTime(e.ts)}</div>
            <div className="main">
              <div className="title">
                {e.kind === 'overlay' ? 'Overlay appeared: ' : e.kind === 'shield' ? 'Shielded: ' : e.kind === 'block' ? 'Blocked: ' : ''}
                {e.kind === 'block' ? e.title : `${e.proc}.exe — ${e.title}`}
              </div>
              <div className="sub">
                {e.kind === 'focus' && <>from {e.prev || 'unknown'} · idle {fmtIdle(e.idleMs)}</>}
                {e.kind !== 'focus' && e.note}
              </div>
              <div className="tags">
                {e.selfActivated && <span className="tag warn">took focus on its own</span>}
                {e.flag && <><Risk risk={e.flag.risk} /><span className="tag">{e.flag.label}</span></>}
              </div>
            </div>
            {e.kind === 'focus' && (
              <div className="actions">
                <button type="button" className="ghost" onClick={() => post('/api/window/focus', { hwnd: e.hwnd })}>Bring to front</button>
              </div>
            )}
          </article>
        ))}
        {!events.length && <div className="empty">Nothing logged yet. Switch windows and events will appear here.</div>}
      </div>
    </>
  );
}
