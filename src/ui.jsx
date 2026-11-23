import React from 'react';

/* Shared UI building blocks used by the live app and the clickable demo. */

export const Paw = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <ellipse cx="5" cy="10" rx="2.2" ry="3" /><ellipse cx="9.5" cy="5.5" rx="2.2" ry="3" />
    <ellipse cx="14.5" cy="5.5" rx="2.2" ry="3" /><ellipse cx="19" cy="10" rx="2.2" ry="3" />
    <path d="M12 11c-3.3 0-6 2.6-6 5.4 0 2 1.6 3 3.2 3 1.2 0 1.8-.5 2.8-.5s1.6.5 2.8.5c1.6 0 3.2-1 3.2-3 0-2.8-2.7-5.4-6-5.4z" />
  </svg>
);

export const Icon = ({ d }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const icons = {
  today: <Icon d={<><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M4 10h16" /></>} />,
  visit: <Icon d={<><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M12 9v6M9 12h6" /></>} />,
  home: <Icon d={<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />} />,
  access: <Icon d={<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>} />,
  search: <Icon d={<><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></>} />,
};

export function Shell({ title, onBack, tabs, tab, onTab, onHome, homeLabel = 'Switch app', children, overlay }) {
  return (
    <>
      <div className="topbar">
        {onBack ? <button className="back" onClick={onBack}>‹ Back</button> : <span />}
        <div className="logo"><Paw /> {title || 'PawFile'}</div>
        {!onBack && onHome ? <button className="home-link" onClick={onHome}>{homeLabel}</button> : <span />}
      </div>
      <div className="content">{children}</div>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => onTab(t.id)} aria-current={tab === t.id}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>
      {overlay}
    </>
  );
}

export const Banner = ({ kind, title, children }) => (
  <div className={`banner ${kind}`} role={kind === 'err' ? 'alert' : undefined}>
    <b>{kind === 'ok' ? '✓' : kind === 'err' ? '⚠' : kind === 'warn' ? '⚠' : 'ℹ'} {title}</b>
    {children}
  </div>
);

export const Btn = ({ kind = 'primary', ...p }) => <button className={`btn ${kind}`} {...p} />;

export const Radio = ({ on, children, ...p }) => (
  <button className={`radio ${on ? 'on' : ''}`} role="radio" aria-checked={on} {...p}><span className="dot" />{children}</button>
);

export const Demo = ({ who, children }) => (
  <div className="demo"><span className="label">Demo control · simulates {who}</span>{children}</div>
);

export const Field = ({ label, error, children }) => (
  <div className={`field ${error ? 'bad' : ''}`}>
    <label>{label}</label>
    {children}
    {error && <div className="err-text" role="alert">{error}</div>}
  </div>
);

/* Mascot: Biscuit the Labrador. mood = happy | sleepy | sad | wow */
export function Mascot({ size = 160, mood = 'happy', wag = true }) {
  const eyes =
    mood === 'sleepy'
      ? <><path d="M62 82q8 6 16 0" stroke="#2a1f1a" strokeWidth="4" fill="none" strokeLinecap="round" /><path d="M122 82q8 6 16 0" stroke="#2a1f1a" strokeWidth="4" fill="none" strokeLinecap="round" /></>
      : <>
          <g className="blink"><ellipse cx="70" cy="80" rx="8" ry="9.5" fill="#2a1f1a" /><circle cx="73" cy="76" r="3" fill="#fff" /></g>
          <g className="blink"><ellipse cx="130" cy="80" rx="8" ry="9.5" fill="#2a1f1a" /><circle cx="133" cy="76" r="3" fill="#fff" /></g>
        </>;
  const brows = mood === 'sad'
    ? <><path d="M58 64l20 -6" stroke="#8a5a2b" strokeWidth="4" strokeLinecap="round" /><path d="M142 64l-20 -6" stroke="#8a5a2b" strokeWidth="4" strokeLinecap="round" /></>
    : null;
  const mouth = mood === 'sad'
    ? <path d="M86 128q14 -10 28 0" stroke="#2a1f1a" strokeWidth="4" fill="none" strokeLinecap="round" />
    : mood === 'wow'
      ? <ellipse cx="100" cy="130" rx="9" ry="11" fill="#7a2e2e" />
      : <><path d="M84 118q16 18 32 0" stroke="#2a1f1a" strokeWidth="4" fill="#7a2e2e" strokeLinejoin="round" /><path d="M94 126q6 16 12 0z" fill="#ff8fa3" /></>;
  return (
    <svg className={`mascot ${wag ? 'wag' : ''}`} width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Biscuit, the PawFile dog mascot">
      <ellipse cx="100" cy="188" rx="52" ry="6" fill="rgba(20,26,43,.12)" />
      <path className="ear-l" d="M42 56c-22 4-30 40-18 66 10 20 30 10 34-8 4-20 0-50-16-58z" fill="#b9792f" />
      <path className="ear-r" d="M158 56c22 4 30 40 18 66-10 20-30 10-34-8-4-20 0-50 16-58z" fill="#b9792f" />
      <path d="M100 30c-36 0-62 24-62 62 0 40 26 68 62 68s62-28 62-68c0-38-26-62-62-62z" fill="#e0a553" />
      <ellipse cx="100" cy="116" rx="36" ry="30" fill="#f6dcae" />
      {brows}{eyes}
      <path d="M86 102c0-8 28-8 28 0 0 8-10 14-14 14s-14-6-14-14z" fill="#2a1f1a" />
      <ellipse cx="94" cy="100" rx="4" ry="2" fill="rgba(255,255,255,.5)" />
      {mouth}
      <path d="M62 156q38 20 76 0l4 14q-42 22 -84 0z" fill="#0f7b5f" />
      <circle cx="100" cy="176" r="11" fill="#fff" stroke="#0a5d49" strokeWidth="3" />
      <path d="M100 170v12M94 176h12" stroke="#0f7b5f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
