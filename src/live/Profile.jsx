import React, { useState } from 'react';
import { explain, run, supabase } from '../lib/supabase.js';
import { fmtDate } from '../lib/format.js';
import { Banner, Btn, Field, Person } from '../ui.jsx';

const Row = ({ icon, label, children }) => (
  <div className="prow">
    <span className="prow-icon" aria-hidden="true">{icon}</span>
    <span className="grow"><span className="small tight">{label}</span><br /><b>{children}</b></span>
  </div>
);

/**
 * Account page for both roles: who you are, how you sign in, and how clinics can reach you.
 * Only name and phone can be changed here (the database blocks everything else).
 * activity: optional [{id, title, sub, pill, warn}] shown as a log. demo: skip the database.
 */
export default function Profile({ profile, clinic, activity = [], onRefresh, onSignOut, demo = false }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [local, setLocal] = useState(null); // demo only: edits are kept in memory
  const shown = { ...profile, ...(local || {}) };
  const isVet = shown.role === 'vet';

  const save = async () => {
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    setBusy(true); setErr('');
    try {
      if (demo) setLocal({ full_name: name.trim(), phone: phone.trim() || null });
      else {
        await run(supabase.from('profiles').update({ full_name: name.trim(), phone: phone.trim() || null }).eq('id', profile.id));
        await onRefresh?.();
      }
      setEdit(false); setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setErr(explain(e)); }
    setBusy(false);
  };

  return (
    <>
      <section className="pcard">
        <Person profile={shown} size={84} />
        <h1>{shown.full_name || 'Your account'}</h1>
        <p className="meta tight">{shown.email}</p>
        <div className="chips center">
          <span className="chip">{isVet ? '🩺 Veterinarian' : '🐾 Pet owner'}</span>
          {isVet && clinic && <span className={`chip ${clinic.verified ? '' : 'warn'}`}>{clinic.verified ? '✓ Verified clinic' : 'Clinic not yet verified'}</span>}
        </div>
      </section>

      {saved && <Banner kind="ok" title="Saved">Your details are up to date.</Banner>}
      {err && <Banner kind="err" title="That didn’t work">{err}</Banner>}

      <div className="card section">
        <div className="section-head"><span className="section-icon" aria-hidden="true">🪪</span><h2>Account details</h2>
          {!edit && <button className="mini" onClick={() => { setName(shown.full_name || ''); setPhone(shown.phone || ''); setEdit(true); }}>Edit</button>}
        </div>
        {edit ? (
          <>
            <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
            <Field label={isVet ? 'Work phone (optional)' : 'Mobile number'}><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+370 612 34 567" autoComplete="tel" /></Field>
            {!isVet && <p className="small tight">A vet can find your pets with this number. They still need your approval to see anything.</p>}
            <div className="btns"><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn><Btn kind="secondary" onClick={() => { setEdit(false); setErr(''); }}>Cancel</Btn></div>
          </>
        ) : (
          <>
            <Row icon="👤" label="Name">{shown.full_name || 'Not set'}</Row>
            <Row icon="✉️" label="Email">{shown.email || '—'}</Row>
            <Row icon="📱" label={isVet ? 'Work phone' : 'Mobile number'}>{shown.phone || 'Not added'}</Row>
            {isVet && clinic && <Row icon="🏥" label="Clinic">{clinic.name}{clinic.city ? ` · ${clinic.city}` : ''}</Row>}
          </>
        )}
      </div>

      <div className="card section">
        <div className="section-head"><span className="section-icon" aria-hidden="true">🔐</span><h2>Login & security</h2></div>
        <Row icon="🔑" label="Signed in with">Google</Row>
        {!isVet && <Row icon="🔢" label="Approval PIN">{shown.has_pin ? 'Set · asked before every share' : 'Not set'}</Row>}
        <Row icon="📅" label="Member since">{shown.created_at ? fmtDate(shown.created_at) : '—'}</Row>
        <p className="small tight">{isVet ? 'Every record you open and every visit you add is logged against your name.' : 'Nothing is shared without your PIN, and you can stop any clinic at any time.'}</p>
      </div>

      {activity.length > 0 && (
        <div className="card section">
          <div className="section-head"><span className="section-icon" aria-hidden="true">🧾</span><h2>Recent activity</h2></div>
          <ul className="vlist">
            {activity.map((a) => (
              <li key={a.id}>
                <span className={`dot-s ${a.warn ? 'warn' : 'ok'}`} aria-hidden="true" />
                <span className="grow"><b>{a.title}</b><br /><span className="small">{a.sub}</span></span>
                {a.pill && <span className={`pill ${a.warn ? 'warn' : ''}`}>{a.pill}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Btn kind="secondary" onClick={onSignOut}>Sign out</Btn>
      <p className="note center">PawFile prototype · your data is protected by row-level security</p>
    </>
  );
}
