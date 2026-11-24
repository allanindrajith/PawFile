import React from 'react';
import { Avatar, I, Person } from '../ui.jsx';

/* Home-screen building blocks shared by the owner app, vet app and demo:
   a hero card, a row of quick actions, a promo carousel and a tip card. */

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Hero({ eyebrow, title, line, profile, onProfile, pet, children }) {
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <section className="hero-home">
      <div className="hh-top">
        <span className="hh-date">{eyebrow || date}</span>
        {profile && <button onClick={onProfile} aria-label="Open your profile"><Person profile={profile} size={36} /></button>}
      </div>
      <h1>{title}</h1>
      {line && <p className="hh-line">{line}</p>}
      {pet && (
        <div className="hh-pet">
          <Avatar pet={pet} size={44} />
          <span><b>{pet.name}</b><small>{pet.breed || pet.species}</small></span>
        </div>
      )}
      {children}
    </section>
  );
}

export function QuickActions({ items }) {
  return (
    <div className="quick">
      {items.map((q) => (
        <button key={q.label} onClick={q.onClick} className="q-item">
          <span className="q-ico"><I n={q.icon} size={22} /></span>
          <span className="q-label">{q.label}</span>
        </button>
      ))}
    </div>
  );
}

const PROMOS = [
  { id: 'p1', tag: 'Sponsored', title: 'Hearty Bowl adult dog food', sub: 'Vet-formulated, 15% off your first bag', cta: 'See offer', tone: 'a' },
  { id: 'p2', tag: 'Sponsored', title: 'JointCare chews for senior dogs', sub: 'Supports mobility. Free delivery over €30', cta: 'Learn more', tone: 'b' },
  { id: 'p3', tag: 'Sponsored', title: 'Purr & Co. kitten starter pack', sub: 'Food, treats and a vet check voucher', cta: 'Shop now', tone: 'c' },
];

const ART = {
  a: ( /* food bowl with kibble */
    <svg viewBox="0 0 220 110" aria-hidden="true">
      <ellipse cx="110" cy="92" rx="70" ry="9" fill="#000" opacity=".08" />
      <path d="M50 56h120c0 26-24 38-60 38S50 82 50 56z" fill="#c8794a" />
      <path d="M50 56h120c0 6-2 11-5 15H55c-3-4-5-9-5-15z" fill="#e39a6a" />
      <ellipse cx="110" cy="56" rx="60" ry="9" fill="#8a4f2c" />
      {[[80,50],[96,46],[112,49],[128,45],[144,50],[100,54],[122,54],[88,55],[136,55]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" fill={i % 2 ? '#b5651d' : '#d28a3d'} />)}
      <circle cx="176" cy="30" r="3" fill="#fff" opacity=".7" /><circle cx="42" cy="26" r="2" fill="#fff" opacity=".7" />
    </svg>
  ),
  b: ( /* dog with bone */
    <svg viewBox="0 0 220 110" aria-hidden="true">
      <ellipse cx="110" cy="98" rx="62" ry="7" fill="#000" opacity=".08" />
      <path d="M62 44c-14 2-20 18-12 34 4 8 12 8 14 0l4-18z" fill="#8b5a2b" />
      <path d="M158 44c14 2 20 18 12 34-4 8-12 8-14 0l-4-18z" fill="#8b5a2b" />
      <ellipse cx="110" cy="58" rx="46" ry="42" fill="#d9a066" />
      <ellipse cx="110" cy="74" rx="24" ry="18" fill="#f3d9b5" />
      <ellipse cx="110" cy="66" rx="9" ry="6.5" fill="#2b1d12" />
      <circle cx="90" cy="50" r="5" fill="#2b1d12" /><circle cx="130" cy="50" r="5" fill="#2b1d12" />
      <circle cx="91.5" cy="48.5" r="1.6" fill="#fff" /><circle cx="131.5" cy="48.5" r="1.6" fill="#fff" />
      <path d="M102 80q8 8 16 0" stroke="#2b1d12" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <g transform="translate(150 80) rotate(-25)"><rect x="-22" y="-5" width="44" height="10" rx="5" fill="#fff" /><circle cx="-22" cy="-5" r="6" fill="#fff" /><circle cx="-22" cy="5" r="6" fill="#fff" /><circle cx="22" cy="-5" r="6" fill="#fff" /><circle cx="22" cy="5" r="6" fill="#fff" /></g>
    </svg>
  ),
  c: ( /* kitten */
    <svg viewBox="0 0 220 110" aria-hidden="true">
      <ellipse cx="110" cy="98" rx="58" ry="7" fill="#000" opacity=".08" />
      <path d="M70 50L62 14l32 20z" fill="#b8b2a8" /><path d="M150 50l8-36-32 20z" fill="#b8b2a8" />
      <path d="M72 42l-4-16 14 10z" fill="#f2b8b0" /><path d="M148 42l4-16-14 10z" fill="#f2b8b0" />
      <ellipse cx="110" cy="62" rx="44" ry="38" fill="#cfc9be" />
      <path d="M96 30q4 10 0 16M110 28v18M124 30q-4 10 0 16" stroke="#9a9488" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="92" cy="60" rx="6" ry="8" fill="#3b7d5f" /><ellipse cx="128" cy="60" rx="6" ry="8" fill="#3b7d5f" />
      <ellipse cx="92" cy="60" rx="2" ry="6" fill="#111" /><ellipse cx="128" cy="60" rx="2" ry="6" fill="#111" />
      <path d="M105 74h10l-5 6z" fill="#e08b8b" /><path d="M110 80q-6 8-14 4M110 80q6 8 14 4" stroke="#6b665c" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M70 72h-22M70 78l-20 6M150 72h22M150 78l20 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

export function PromoCarousel({ onTap }) {
  return (
    <>
      <div className="sec-head"><h2>For your pet</h2><span className="small tight">Ads</span></div>
      <div className="promos" role="list">
        {PROMOS.map((p) => (
          <article key={p.id} className={`promo ${p.tone}`} role="listitem">
            <div className="promo-art">{ART[p.tone]}<span className="promo-tag">{p.tag}</span></div>
            <div className="promo-body"><h3>{p.title}</h3><p>{p.sub}</p><button onClick={() => onTap && onTap(p)}>{p.cta}</button></div>
          </article>
        ))}
      </div>
    </>
  );
}

export function TipCard({ title = 'Tip of the day', children }) {
  return (
    <div className="tip">
      <span className="tip-ico"><I n="steth" size={20} /></span>
      <div><b>{title}</b><p>{children}</p></div>
    </div>
  );
}

export function RequestList({ items, onOpen, title = 'Needs your answer', icon = 'mail' }) {
  if (!items.length) return null;
  return (
    <>
      <div className="sec-head"><h2>{title}</h2><span className="count">{items.length}</span></div>
      <div className="group">
        {items.map((r) => (
          <button key={r.id} className="grow-row" onClick={() => onOpen(r)}>
            <span className={`row-ico ${r.warn === false ? 'mute' : ''}`}><I n={icon} size={20} /></span>
            <span className="row-main"><b>{r.title}</b><small>{r.sub}</small></span>
            <span className="row-go">{r.cta || 'Review'} ›</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function PetFeature({ pet, stats, badge, onOpen }) {
  return (
    <button className="feature" onClick={onOpen}>
      <div className="ft-head">
        <Avatar pet={pet} size={84} ring />
        <div className="ft-name">
          <h3>{pet.name}</h3>
          <span>{[pet.breed || pet.species, pet.sex].filter(Boolean).join(' · ')}</span>
          {badge && <em>{badge}</em>}
        </div>
      </div>
      <div className="ft-stats">
        {stats.map((s) => (<div key={s.l}><b>{s.v}</b><span>{s.l}</span></div>))}
      </div>
      <div className="ft-open">Open health record ›</div>
    </button>
  );
}

const ICON_FOR = { Weight: 'hash', 'Next vaccine': 'syringe', Medication: 'steth', 'Last visit': 'calendar', Appointments: 'calendar', Waiting: 'clipboard', Licence: 'id', Clinic: 'building', 'Open records': 'clipboard', Sharing: 'lock', Requests: 'mail', Record: 'clipboard' };

export function Tiles({ items, title = 'Health snapshot' }) {
  return (
    <>
      <div className="sec-head"><h2>{title}</h2></div>
      <div className="tiles">
        {items.map((x) => (
          <div key={x.label} className={`tile ${x.tone}`}>
            <span className="t-ico"><I n={ICON_FOR[x.label] || 'steth'} size={18} /></span>
            <span className="t-label">{x.label}</span>
            <b>{x.value}</b>
            <span className="t-sub">{x.sub}</span>
          </div>
        ))}
      </div>
    </>
  );
}
