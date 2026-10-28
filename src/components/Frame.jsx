import React from 'react';
import Logo from './Logo.jsx';
import WindowControls from './WindowControls.jsx';

export default function Frame({ children, onLock }) {
  const dragMax = () => window.watchtower?.maximize();
  return (
    <div className="stage">
      <div className="sky" aria-hidden="true" />
      <div className="flow" aria-hidden="true" />
      <div className="grid" aria-hidden="true" />
      <div className="scan" aria-hidden="true" />
      <header className="top" onDoubleClick={dragMax}>
        <div className="brand">
          <Logo />
          <div>
            <strong>Watchtower</strong>
            <em>signal desk</em>
          </div>
        </div>
        <div className="top-actions">
          {onLock && <button type="button" className="lock-btn" onClick={onLock}>Lock</button>}
          <WindowControls />
        </div>
      </header>
      <div className="body">{children}</div>
    </div>
  );
}
