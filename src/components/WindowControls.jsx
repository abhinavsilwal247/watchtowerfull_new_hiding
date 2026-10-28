import React, { useEffect, useState } from 'react';

export default function WindowControls() {
  const api = typeof window !== 'undefined' ? window.watchtower : null;
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    if (!api?.onMaximized) return undefined;
    return api.onMaximized(setMaxed);
  }, [api]);
  if (!api) return null;
  return (
    <div className="chrome">
      <button type="button" aria-label="Minimize" onClick={() => api.minimize()}>
        <i />
      </button>
      <button type="button" aria-label={maxed ? 'Restore' : 'Maximize'} onClick={() => api.maximize()}>
        <b className={maxed ? 'restore' : ''} />
      </button>
      <button type="button" className="close" aria-label="Close" onClick={() => api.close()}>
        <s />
      </button>
    </div>
  );
}
