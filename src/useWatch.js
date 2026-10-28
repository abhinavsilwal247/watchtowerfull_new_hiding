import { useEffect, useState } from 'react';

// Subscribes to the local server's SSE stream; reconnects automatically.
export function useWatch(enabled = true) {
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    if (!enabled) { setData(null); setOnline(false); return undefined; }
    const es = new EventSource('/api/stream');
    es.onopen = () => setOnline(true);
    es.onmessage = (e) => { setOnline(true); setData(JSON.parse(e.data)); };
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, [enabled]);
  return { data, online };
}

export const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
