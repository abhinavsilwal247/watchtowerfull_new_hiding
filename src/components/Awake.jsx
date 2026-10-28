import React from 'react';
import { post } from '../useWatch.js';

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });

export default function Awake({ data }) {
  const on = !!data.awake;
  return (
    <div className="card">
      <p className="eyebrow">Power</p>
      <h3>Keep awake</h3>
      <p className="muted">Stops sleep and display-off with the Windows execution-state API. It does not move the mouse or press keys.</p>
      <div className="toolbar">
        <button type="button" className="black" onClick={() => post('/api/awake', { on: !on, display: true })}>{on ? 'Stop' : 'Keep system and display awake'}</button>
        {!on && <button type="button" className="ghost" onClick={() => post('/api/awake', { on: true, display: false })}>System only</button>}
        {on && <span className="pill fg">Active {data.awake.display ? '· display on' : '· system only'} · since {fmtTime(data.awake.since)}</span>}
      </div>
    </div>
  );
}
