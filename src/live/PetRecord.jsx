import React from 'react';
import { ageOf, fmtChip, fmtDate, vaccStatus } from '../lib/format.js';
import { Avatar, I } from '../ui.jsx';

/* Presentational pieces of a pet's medical record, shared by the owner app, the vet app and the demo. */

/** Cover, big photo, name and a one-line summary. Pass onPhoto(file) to let the owner change the picture. */
export function PetHero({ pet, onPhoto, busy, badges = [] }) {
  return (
    <section className="hero">
      <div className="hero-cover" aria-hidden="true" />
      <div className="hero-photo">
        <Avatar pet={pet} size={116} ring />
        {onPhoto && (
          <label className={`cam ${busy ? 'busy' : ''}`} title="Change photo">
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhoto(f); }} />
            {busy ? '…' : <I n="camera" size={16} />}
          </label>
        )}
      </div>
      <h1 className="hero-name">{pet.name}</h1>
      <p className="hero-sub">{[pet.breed || pet.species, pet.sex].filter(Boolean).join(' · ')}</p>
      {badges.length > 0 && <div className="chips center">{badges}</div>}
    </section>
  );
}

const lastDigits = (c) => (c ? `…${fmtChip(c).slice(-7)}` : '—');

export function StatRow({ pet }) {
  const items = [
    ['Age', ageOf(pet.birth_date) || '—'],
    ['Weight', pet.weight_kg ? `${pet.weight_kg} kg` : '—'],
    ['Sex', pet.sex || '—'],
    ['Microchip', lastDigits(pet.chip)],
  ];
  return (
    <div className="stats">
      {items.map(([k, v]) => (
        <div className="stat" key={k}><b>{v}</b><span>{k}</span></div>
      ))}
    </div>
  );
}

export const Section = ({ icon, title, count, tone, children }) => (
  <div className={`card section ${tone || ''}`}>
    <div className="section-head"><span className="section-icon" aria-hidden="true">{icon}</span><h2>{title}</h2>{count != null && <span className="pill">{count}</span>}</div>
    {children}
  </div>
);

export function AlertsCard({ alerts, children }) {
  return (
    <Section icon={<I n="alert" />} title="Alerts" count={alerts.length || null} tone={alerts.length ? 'alert' : ''}>
      {alerts.length === 0 ? <p className="meta tight">No allergies or alerts recorded.</p> : (
        <div className="chips">
          {alerts.map((a) => (
            <span key={a.id} className="chip danger">{a.kind && a.kind !== 'allergy' ? `${a.kind}: ` : 'Allergy: '}{a.substance}</span>
          ))}
        </div>
      )}
      {alerts.some((a) => a.source) && <p className="small tight">Source: {[...new Set(alerts.map((a) => a.source).filter(Boolean))].join(', ')}</p>}
      {children}
    </Section>
  );
}

export function VaccCard({ vaccs, children }) {
  return (
    <Section icon={<I n="syringe" />} title="Vaccinations" count={vaccs.length || null}>
      {vaccs.length === 0 && <p className="meta tight">None recorded yet.</p>}
      <ul className="vlist">
        {vaccs.map((v) => {
          const st = vaccStatus(v);
          return (
            <li key={v.id}>
              <span className={`dot-s ${st.tone === 'warn' ? 'warn' : 'ok'}`} aria-hidden="true" />
              <span className="grow"><b>{v.name}</b><br /><span className={st.tone === 'warn' ? 'warn-text small' : 'small'}>{st.text}</span></span>
              {v.clinic_name && <span className="small right">{v.clinic_name}</span>}
            </li>
          );
        })}
      </ul>
      {children}
    </Section>
  );
}

/** Vertical timeline of visits. extra(visit) can add buttons or notes under a visit. */
export function Timeline({ visits, extra, empty = 'Visits added by clinics appear here.' }) {
  const clinics = new Set(visits.map((v) => v.clinic_name).filter(Boolean)).size;
  return (
    <Section icon={<I n="steth" />} title="Visit history" count={visits.length ? `${visits.length} visit${visits.length === 1 ? '' : 's'}${clinics > 1 ? ` · ${clinics} clinics` : ''}` : null}>
      {visits.length === 0 && <p className="meta tight">{empty}</p>}
      <ol className="timeline">
        {visits.map((v) => (
          <li key={v.id} className={v.lab_missing ? 'flag' : ''}>
            <span className="tl-dot" aria-hidden="true" />
            <div className="tl-date">{fmtDate(v.visit_date)}{v.clinic_name ? ` · ${v.clinic_name}` : ''}</div>
            <div className="tl-main"><b>{v.diagnosis || v.reason || 'Visit'}</b>{v.treatment ? <span> · {v.treatment}</span> : null}</div>
            {v.reason && v.diagnosis && <div className="small tight">Reason: {v.reason}</div>}
            {v.allergy_override_reason && <div className="small warn-text tight">Allergy warning overridden: {v.allergy_override_reason}</div>}
            {extra && extra(v)}
          </li>
        ))}
      </ol>
    </Section>
  );
}
