import React from 'react';
import { post } from '../useWatch.js';

const RISK_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });
function Risk({ risk }) { return <span className={`pill ${risk}`}>{RISK_LABEL[risk]}</span>; }

export default function Suspects({ data }) {
  const counts = data.suspects.reduce((a, s) => ({ ...a, [s.risk]: (a[s.risk] || 0) + 1 }), {});
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {data.scanAt ? `Last scan ${fmtTime(data.scanAt)}` : 'Scanning…'} · {counts.high || 0} high · {counts.medium || 0} medium · {counts.low || 0} low
        </span>
        <button type="button" className="ghost" onClick={() => post('/api/scan')}>Rescan now</button>
      </div>
      <div className="list">
        {data.suspects.map((s) => (
          <article key={`${s.kind}-${s.pid}-${s.name}`} className={`row ${s.risk}`}>
            <div className="main">
              <div className="title"><Risk risk={s.risk} /> {s.label} <span className="muted">· {s.kind}</span></div>
              <div className="sub">{s.name}{s.display ? ` (${s.display})` : ''} · PID {s.pid}{s.path ? ` · ${s.path}` : ''}</div>
              <div className="tags">
                <span className="tag">{s.category.replace('-', ' ')}</span>
                <span className="tag">{s.reason}</span>
                {s.conns > 0 && <span className="tag warn">{s.conns} outbound connection{s.conns > 1 ? 's' : ''}: {s.remotes.join(', ')}</span>}
              </div>
            </div>
          </article>
        ))}
        {!data.suspects.length && <div className="empty">No known monitoring, remote-access or capture software found running.</div>}
      </div>
      <p className="note">
        This matches a list of known products plus a name heuristic. A renamed tool, a kernel driver, or a phone pointed at the screen will not show up. A match is a lead to check, not proof.
      </p>
    </>
  );
}
