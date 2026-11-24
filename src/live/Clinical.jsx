import React, { useState } from 'react';
import { explain } from '../lib/supabase.js';
import { fmtDate, fmtDateTime, ago } from '../lib/format.js';
import { Banner, Btn, Field, I } from '../ui.jsx';
import { Section } from './PetRecord.jsx';
import { remindersFor } from '../lib/reminders.js';
export { remindersFor };
import { LANGS, getLang, setLang, useLang, t } from '../lib/i18n.js';

/* Clinical-record cards shared by the owner app, the vet app and the demo.
   Cards only call the handlers they are given, so the demo can pass in-memory ones. */

/** Run an async handler, showing a short error under the form instead of throwing. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); return true; } catch (e) { setErr(explain(e)); return false; } finally { setBusy(false); }
  };
  return { busy, err, run };
}
const ErrLine = ({ err }) => (err ? <p className="err-text" role="alert">{err}</p> : null);

/* ---------- weight ---------- */
export function WeightCard({ logs = [], canEdit, onAdd }) {
  const [kg, setKg] = useState('');
  const { busy, err, run } = useAction();
  const pts = logs.map((l) => ({ d: new Date(l.measured_on).getTime(), w: Number(l.weight_kg) }));
  const W = 300, H = 90, pad = 10;
  let chart = null;
  if (pts.length >= 2) {
    const xs = pts.map((p) => p.d), ys = pts.map((p) => p.w);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const X = (v) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const Y = (v) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} className="wchart" role="img" aria-label={`Weight over time, latest ${pts[pts.length - 1].w} kilograms`}>
        <polyline points={pts.map((p) => `${X(p.d)},${Y(p.w)}`).join(' ')} fill="none" stroke="var(--green)" strokeWidth="2" strokeLinejoin="round" />
        {pts.map((p, i) => <circle key={i} cx={X(p.d)} cy={Y(p.w)} r="3" fill="var(--green)" />)}
      </svg>
    );
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const delta = last && prev ? Math.round((last.w - prev.w) * 10) / 10 : null;
  return (
    <Section icon={<I n="steth" size={16} />} title={t('weight')} count={logs.length || null}>
      {chart || <p className="small tight">{logs.length ? 'One measurement so far. A second one draws the chart.' : 'No weight recorded yet.'}</p>}
      {last && <p className="small">Latest {last.w} kg{delta != null && delta !== 0 ? ` · ${delta > 0 ? '+' : ''}${delta} kg since the last time` : ''}</p>}
      {canEdit && (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const n = Number(kg); if (!(n > 0 && n < 500)) return; run(async () => { await onAdd(n); setKg(''); }); }}>
          <input inputMode="decimal" placeholder="kg, e.g. 31.5" value={kg} onChange={(e) => setKg(e.target.value)} aria-label="Weight in kilograms" />
          <button className="mini" disabled={busy || !kg}>Add</button>
        </form>
      )}
      <ErrLine err={err} />
    </Section>
  );
}

/* ---------- medications ---------- */
export function MedsCard({ meds = [], canEdit, onAdd }) {
  const [f, setF] = useState({ name: '', dose: '', freq: '', end: '' });
  const [open, setOpen] = useState(false);
  const { busy, err, run } = useAction();
  const today = new Date().toISOString().slice(0, 10);
  const active = meds.filter((m) => !m.end_on || m.end_on >= today);
  const past = meds.filter((m) => m.end_on && m.end_on < today);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Section icon={<I n="syringe" size={16} />} title={t('medications')} count={active.length || null}>
      {active.length === 0 && <p className="small tight">No current medication.</p>}
      <ul className="vlist">
        {active.map((m) => (
          <li key={m.id}><span className="dot-s ok" aria-hidden="true" /><span className="grow"><b>{m.name}</b><br /><span className="small tight">{[m.dose, m.frequency].filter(Boolean).join(' · ') || '—'}{m.end_on ? ` · until ${fmtDate(m.end_on)}` : ' · ongoing'}</span></span><span className="right small">{m.prescribed_by}</span></li>
        ))}
      </ul>
      {past.length > 0 && <p className="small">Past: {past.map((m) => m.name).join(', ')}</p>}
      {canEdit && !open && <button className="mini" onClick={() => setOpen(true)}>Add medication</button>}
      {canEdit && open && (
        <form onSubmit={(e) => { e.preventDefault(); if (!f.name.trim()) return; run(async () => { await onAdd(f); setF({ name: '', dose: '', freq: '', end: '' }); setOpen(false); }); }}>
          <Field label="Medicine"><input value={f.name} onChange={set('name')} /></Field>
          <Field label="Dose"><input value={f.dose} onChange={set('dose')} placeholder="e.g. 1.5 ml" /></Field>
          <Field label="How often"><input value={f.freq} onChange={set('freq')} placeholder="e.g. once a day" /></Field>
          <Field label="Until (optional)"><input type="date" value={f.end} onChange={set('end')} /></Field>
          <div className="btns"><Btn disabled={busy}>Save medication</Btn><Btn kind="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn></div>
        </form>
      )}
      <ErrLine err={err} />
    </Section>
  );
}

/* ---------- documents ---------- */
const KINDS = [['lab', 'Lab result'], ['imaging', 'Imaging'], ['certificate', 'Certificate'], ['other', 'Other']];
export function DocsCard({ docs = [], canEdit, onUpload, onOpen }) {
  const [kind, setKind] = useState('lab');
  const { busy, err, run } = useAction();
  return (
    <Section icon={<I n="clipboard" size={16} />} title={t('documents')} count={docs.length || null}>
      {docs.length === 0 && <p className="small tight">No documents yet.</p>}
      <ul className="vlist">
        {docs.map((d) => (
          <li key={d.id}>
            <span className="grow"><button className="link-row" onClick={() => run(() => onOpen(d.path))}>{d.title}</button><br />
              <span className="small tight">{KINDS.find(([k]) => k === d.kind)?.[1]} · {fmtDate(d.created_at)} · {d.uploaded_by}</span></span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="inline-form">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="mini">{busy ? 'Uploading…' : 'Upload file'}
            <input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) run(() => onUpload(file, kind)); }} />
          </label>
        </div>
      )}
      <ErrLine err={err} />
    </Section>
  );
}

/* ---------- audit log ---------- */
const ACTIONS = {
  view_record: 'viewed the record', add_visit: 'added a visit', amend_visit: 'corrected a visit', add_medication: 'added a medication',
  add_weight: 'added a weight', add_document: 'uploaded a document', export_passport: 'printed the health summary', book_appointment: 'booked an appointment',
};
export function AuditCard({ log = [], title = t('activity') }) {
  return (
    <Section icon={<I n="lock" size={16} />} title={title} count={log.length || null}>
      {log.length === 0 && <p className="small tight">Nobody outside your household has opened this record.</p>}
      <ul className="audit">
        {log.map((l) => (
          <li key={l.id}>
            <b>{l.actor_name || 'Someone'}</b>{l.clinic_name ? ` · ${l.clinic_name}` : ''}<br />
            <span className="small tight">{ACTIONS[l.action] || l.action}{l.detail && l.action !== 'view_record' ? `: ${l.detail}` : ''} · {ago(l.created_at)}</span>
          </li>
        ))}
      </ul>
      <p className="small">Entries cannot be edited or deleted.</p>
    </Section>
  );
}

/* ---------- appointments ---------- */
export function AppointmentsCard({ appts = [], canBook, onBook, onStatus, who = 'clinic' }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const { busy, err, run } = useAction();
  const now = Date.now();
  const upcoming = appts.filter((a) => a.status === 'booked' && new Date(a.starts_at).getTime() >= now - 36e5);
  return (
    <Section icon={<I n="calendar" size={16} />} title={t('appointments')} count={upcoming.length || null}>
      {upcoming.length === 0 && <p className="small tight">Nothing booked.</p>}
      <ul className="vlist">
        {upcoming.map((a) => (
          <li key={a.id}><span className="grow"><b>{fmtDateTime(a.starts_at)}</b><br /><span className="small tight">{a.reason || 'Check-up'}{who === 'owner' ? '' : ''}</span></span>
            <button className="mini" disabled={busy} onClick={() => run(() => onStatus(a.id, 'cancelled'))}>Cancel</button></li>
        ))}
      </ul>
      {canBook && !open && <button className="mini" onClick={() => setOpen(true)}>Book a visit</button>}
      {canBook && open && (
        <form onSubmit={(e) => { e.preventDefault(); if (!at) return; run(async () => { await onBook(new Date(at).toISOString(), reason); setAt(''); setReason(''); setOpen(false); }); }}>
          <Field label="Date and time"><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="btns"><Btn disabled={busy || !at}>Book</Btn><Btn kind="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn></div>
        </form>
      )}
      <ErrLine err={err} />
    </Section>
  );
}

/* ---------- amend a visit (vet) ---------- */
export function AmendBox({ visit, amendments = [], onSave }) {
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(visit.diagnosis || '');
  const [tx, setTx] = useState(visit.treatment || '');
  const [why, setWhy] = useState('');
  const { busy, err, run } = useAction();
  const mine = amendments.filter((a) => a.visit_id === visit.id);
  return (
    <div className="amend">
      {mine.map((a) => (
        <p key={a.id} className="small tight amend-note">Corrected by {a.amended_name} · {ago(a.created_at)}. Reason: {a.reason}. Was: “{a.old_values?.diagnosis}”{a.old_values?.treatment ? ` · ${a.old_values.treatment}` : ''}</p>
      ))}
      {onSave && !open && <button className="link-row quiet" onClick={() => setOpen(true)}>Correct this note</button>}
      {onSave && open && (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await onSave(visit.id, dx, tx, why); setOpen(false); setWhy(''); }); }}>
          <Field label="Diagnosis"><input value={dx} onChange={(e) => setDx(e.target.value)} /></Field>
          <Field label="Treatment"><input value={tx} onChange={(e) => setTx(e.target.value)} /></Field>
          <Field label="Why are you correcting it?"><input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="At least 5 characters" /></Field>
          <p className="small">The original text stays on record with your name and the reason.</p>
          <div className="btns"><Btn disabled={busy || why.trim().length < 5 || !dx.trim()}>Save correction</Btn><Btn kind="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Btn></div>
        </form>
      )}
      <ErrLine err={err} />
    </div>
  );
}

/* ---------- owner extras: lost mode, co-owner, transfer ---------- */
export function LostCard({ pet, onToggle }) {
  const [note, setNote] = useState(pet.lost_note || '');
  const { busy, err, run } = useAction();
  if (pet.is_lost) {
    return (
      <Banner kind="err" title={`${pet.name} is marked as lost`}>
        Since {fmtDate(pet.lost_since)}. {pet.lost_note || ''}
        <div style={{ marginTop: 10 }}><Btn kind="secondary" disabled={busy} onClick={() => run(() => onToggle(false, ''))}>{pet.name} is home</Btn></div>
        <ErrLine err={err} />
      </Banner>
    );
  }
  return (
    <Section icon={<I n="alert" size={16} />} title="Lost pet mode">
      <p className="small tight">Marks the record so any clinic that scans the microchip sees you are looking for {pet.name}.</p>
      <Field label="Where was your pet last seen? (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Btn kind="danger" disabled={busy} onClick={() => run(() => onToggle(true, note))}>Mark {pet.name} as lost</Btn>
      <ErrLine err={err} />
    </Section>
  );
}

export function HouseholdCard({ pet, coCount = 0, onAdd, onTransfer }) {
  const [mode, setMode] = useState(null); // 'co' | 'transfer'
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [done, setDone] = useState('');
  const { busy, err, run } = useAction();
  const reset = () => { setMode(null); setEmail(''); setPin(''); };
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const res = mode === 'co' ? await onAdd(email) : await onTransfer(email, pin);
      if (res === 'ok') { setDone(mode === 'co' ? `${email} can now manage ${pet.name}.` : `${pet.name} now belongs to ${email}.`); reset(); }
      else if (res === 'NOT_FOUND') throw new Error('NOT_FOUND');
      else if (res === 'SELF') throw new Error('That is your own email.');
      else if (res === 'PIN_WRONG') throw new Error('That PIN is not right.');
      else if (res === 'PIN_LOCKED') throw new Error('Too many wrong PINs. Try again in 10 minutes.');
      else throw new Error(String(res));
    });
  };
  return (
    <Section icon={<I n="user" size={16} />} title="Household" count={coCount || null}>
      <p className="small tight">Co-owners can see everything and answer clinic requests with their own PIN. The other person needs a PawFile owner account.</p>
      {done && <Banner kind="ok" title="Done">{done}</Banner>}
      {!mode && <div className="btns"><button className="mini" onClick={() => { setMode('co'); setDone(''); }}>Add co-owner</button><button className="mini" onClick={() => { setMode('transfer'); setDone(''); }}>Transfer {pet.name}</button></div>}
      {mode && (
        <form onSubmit={submit}>
          <Field label="Their email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode === 'transfer' && <>
            <Banner kind="warn" title="This hands over the record">Every clinic’s access ends and you lose control of {pet.name}.</Banner>
            <Field label="Your PIN"><input inputMode="numeric" maxLength={4} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></Field>
          </>}
          <div className="btns"><Btn kind={mode === 'transfer' ? 'danger' : 'primary'} disabled={busy || !email || (mode === 'transfer' && pin.length !== 4)}>{mode === 'co' ? 'Add co-owner' : 'Transfer'}</Btn><Btn kind="ghost" type="button" onClick={reset}>Cancel</Btn></div>
        </form>
      )}
      <ErrLine err={err} />
    </Section>
  );
}

/* ---------- reminders (computed from the record) ---------- */
export function RemindersCard({ items }) {
  if (!items.length) return null;
  return <Banner kind="warn" title="Reminders">{items.map((r) => <div key={r.id}>{r.text}</div>)}</Banner>;
}

/* ---------- profile extras ---------- */
export function LanguagePicker() {
  const cur = useLang();
  return (
    <div className="card section">
      <div className="section-head"><h2>{t('language')}</h2></div>
      <div className="seg" role="radiogroup" aria-label={t('language')}>
        {LANGS.map(([k, l]) => <button key={k} role="radio" aria-checked={cur === k} className={cur === k ? 'on' : ''} onClick={() => setLang(k)}>{l}</button>)}
      </div>
      <p className="small">Menus and main buttons are translated; clinical text is still English.</p>
    </div>
  );
}

export function CredentialCard({ cred, onSubmit }) {
  const [lic, setLic] = useState(cred?.license_no || '');
  const [iss, setIss] = useState(cred?.issuer || '');
  const { busy, err, run } = useAction();
  const status = cred?.status;
  return (
    <div className="card section">
      <div className="section-head"><span className="section-icon"><I n="id" size={16} /></span><h2>Vet licence</h2>
        {status && <span className={`pill ${status === 'verified' ? '' : 'warn'}`}>{status === 'verified' ? 'Verified' : status === 'rejected' ? 'Rejected' : 'Pending review'}</span>}</div>
      {status === 'verified' ? <p className="small tight">Licence {cred.license_no} verified. You can add and correct records.</p> : (
        <>
          <p className="small tight">Until your licence is verified you can look records up but not write to them.</p>
          <Field label="Licence number"><input value={lic} onChange={(e) => setLic(e.target.value)} /></Field>
          <Field label="Issued by (e.g. Lithuanian Veterinary Chamber)"><input value={iss} onChange={(e) => setIss(e.target.value)} /></Field>
          <Btn disabled={busy || lic.trim().length < 3} onClick={() => run(() => onSubmit(lic.trim(), iss.trim()))}>{status ? 'Resubmit' : 'Submit for review'}</Btn>
          <ErrLine err={err} />
        </>
      )}
    </div>
  );
}

export function PrivacyCard({ onExport, onDelete }) {
  const [step, setStep] = useState(0);
  const [word, setWord] = useState('');
  const { busy, err, run } = useAction();
  return (
    <div className="card section">
      <div className="section-head"><span className="section-icon"><I n="lock" size={16} /></span><h2>Your data</h2></div>
      <p className="small tight">Get a printable report of everything PawFile holds about you and your pets, or delete your account.</p>
      <Btn kind="secondary" disabled={busy} onClick={() => run(onExport)}>Download my data report (PDF)</Btn>
      {step === 0 && <Btn kind="ghost" onClick={() => setStep(1)}>Delete my account…</Btn>}
      {step === 1 && (
        <div>
          <Banner kind="err" title="This cannot be undone">Your pets and their records are deleted. Clinics keep the visit notes they wrote.</Banner>
          <Field label="Type DELETE to confirm"><input value={word} onChange={(e) => setWord(e.target.value)} /></Field>
          <div className="btns"><Btn kind="danger" disabled={busy || word !== 'DELETE'} onClick={() => run(onDelete)}>Delete everything</Btn><Btn kind="ghost" onClick={() => { setStep(0); setWord(''); }}>Cancel</Btn></div>
        </div>
      )}
      <ErrLine err={err} />
    </div>
  );
}
