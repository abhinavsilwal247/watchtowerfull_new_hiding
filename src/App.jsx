import React, { useEffect, useState } from 'react';
import { useWatch, post } from './useWatch.js';
import LockScreen from './components/LockScreen.jsx';
import Frame from './components/Frame.jsx';

function Desk() {
  const { data, online } = useWatch(true);
  const [busy, setBusy] = useState('');
  if (!data) {
    return <div className="boot">{online ? 'Opening the signal…' : 'Starting Watchtower…'}</div>;
  }
  const rows = data.desk || [];

  async function toggle(row) {
    if (busy) return;
    setBusy(row.proc);
    const next = row.confidential ? null : 'confidential';
    try {
      await post('/api/mark', { proc: row.proc, mark: next });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="list">
      {rows.map((w, i) => (
        <article key={w.id || w.proc} className={w.confidential ? 'secret' : ''} style={{ animationDelay: `${i * 40}ms` }}>
          <div className="main">
            <div className="title">{w.title}</div>
            <div className="sub">
              {w.proc}.exe
              {w.count > 1 ? ` · ${w.count} windows` : ''}
              {w.minimized ? ' · taskbar' : ''}
              {w.confidential ? ' · private' : ''}
            </div>
            {w.confidential && w.captureHide === 'ok' && <div className="status">out of screenshots · behind shows through</div>}
            {w.confidential && w.captureHide === 'refused' && <div className="status bad">run watchtower as administrator</div>}
            {w.confidential && (w.captureHide === 'pending' || !w.captureHide) && <div className="status">hiding from screenshots…</div>}
          </div>
          <button
            type="button"
            className={w.confidential ? 'mark on' : 'mark'}
            disabled={busy === w.proc}
            onClick={() => toggle(w)}
          >
            {busy === w.proc ? 'Saving…' : w.confidential ? 'Confidential' : 'Mark confidential'}
          </button>
        </article>
      ))}
      {!rows.length && <div className="empty">No apps on the taskbar yet.</div>}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    let stop = false;
    const ping = () => {
      fetch('/api/session').then((r) => {
        if (!stop) setAuthed(r.ok);
      }).catch(() => { if (!stop) setTimeout(ping, 1000); });
    };
    ping();
    return () => { stop = true; };
  }, []);

  const lock = () => { post('/api/lock').finally(() => setAuthed(false)); };

  return (
    <Frame onLock={authed ? lock : null}>
      {authed === null && <div className="boot">Starting Watchtower…</div>}
      {authed === false && <LockScreen onUnlock={() => setAuthed(true)} />}
      {authed === true && <Desk />}
    </Frame>
  );
}
