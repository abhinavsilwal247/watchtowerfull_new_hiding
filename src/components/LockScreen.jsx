import React, { useEffect, useRef, useState } from 'react';
import Logo from './Logo.jsx';

const LEN = 4;

export default function LockScreen({ onUnlock }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  useEffect(() => { refs[0].current?.focus(); }, []);

  async function submit(pin) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setError('That PIN is not right.');
        setDigits(['', '', '', '']);
        refs[0].current?.focus();
        return;
      }
      onUnlock();
    } catch {
      setError('Watchtower is not running on this computer.');
    } finally {
      setBusy(false);
    }
  }

  function put(index, raw) {
    const only = raw.replace(/\D/g, '');
    if (!only) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }
    const chars = only.slice(0, LEN - index).split('');
    const next = [...digits];
    chars.forEach((ch, i) => { next[index + i] = ch; });
    setDigits(next);
    setError('');
    const focusAt = Math.min(index + chars.length, LEN - 1);
    refs[focusAt].current?.focus();
    if (next.every(Boolean)) submit(next.join(''));
  }

  function onKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      refs[index - 1].current?.focus();
    }
    if (e.key === 'Enter' && digits.every(Boolean)) submit(digits.join(''));
  }

  return (
    <div className="lock">
      <div className="lock-card">
        <Logo size={84} />
        <p className="eyebrow">watchtower</p>
        <h1>Unlock</h1>
        <p className="lede">Mark a taskbar app confidential and Tivazo screenshots skip it.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (digits.every(Boolean)) submit(digits.join('')); }}>
          <div className="pin" role="group" aria-label="4 digit PIN">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={refs[i]}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className={d ? 'filled' : ''}
                aria-label={`Digit ${i + 1}`}
                maxLength={i === 0 ? 4 : 1}
                value={d}
                disabled={busy}
                onChange={(e) => put(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>
          {error && <p className="pin-error" role="alert">{error}</p>}
          <button type="submit" className="black" disabled={busy || digits.some((d) => !d)}>{busy ? 'Checking…' : 'Unlock'}</button>
        </form>
      </div>
    </div>
  );
}
