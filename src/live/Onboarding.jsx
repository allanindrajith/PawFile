import React, { useEffect, useState } from 'react';
import { explain, rpc, run, supabase } from '../lib/supabase.js';
import { Banner, Btn, Field, Mascot, Paw } from '../ui.jsx';

/** First sign-in: choose vet or owner, finish the profile, and (owners) set a PIN. */
export default function Onboarding({ profile, onDone, onSignOut }) {
  const [role, setRole] = useState(profile.role || null);
  const [name, setName] = useState(profile.full_name || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [clinics, setClinics] = useState([]);
  const [clinicId, setClinicId] = useState('');
  const [newClinic, setNewClinic] = useState({ name: '', city: '', country: '' });
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role === 'vet') run(supabase.from('clinics').select('*').order('name')).then(setClinics).catch((e) => setFail(explain(e)));
  }, [role]);

  const submit = async () => {
    const e = {};
    if (name.trim().length < 2) e.name = 'Please enter your name';
    if (role === 'vet') {
      if (!clinicId) e.clinic = 'Choose your clinic';
      if (clinicId === 'new' && newClinic.name.trim().length < 2) e.clinicName = 'Enter the clinic name';
    } else if (!profile.has_pin) {
      if (!/^\d{4}$/.test(pin)) e.pin = 'Use exactly 4 digits';
      else if (pin !== pin2) e.pin2 = 'The two PINs don’t match';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setFail('');
    try {
      if (role === 'vet') {
        let cid = clinicId;
        if (cid === 'new') {
          const created = await run(supabase.from('clinics').insert({
            name: newClinic.name.trim(), city: newClinic.city.trim() || null, country: newClinic.country.trim() || null,
          }).select('id').single());
          cid = created.id;
        }
        await run(supabase.from('profiles').update({ role: 'vet', full_name: name.trim(), clinic_id: cid }).eq('id', profile.id));
      } else {
        await run(supabase.from('profiles').update({ role: 'owner', full_name: name.trim(), phone: phone.trim() || null }).eq('id', profile.id));
        if (!profile.has_pin) await rpc('set_pin', { p_pin: pin });
      }
      await onDone();
    } catch (err) {
      setFail(explain(err));
      setBusy(false);
    }
  };

  const top = (
    <div className="row between">
      <div className="logo"><Paw /> PawFile</div>
      <button className="home-link" onClick={onSignOut}>Sign out</button>
    </div>
  );

  if (!role) {
    return (
      <div className="landing">
        {top}
        <Mascot size={120} mood="wow" />
        <h1>Welcome{profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}! Who are you?</h1>
        <p className="meta">This is permanent for this account, so pick the one that fits.</p>
        <button className="role" onClick={() => setRole('vet')}>
          <span className="tag">Vet clinic app</span>
          <strong>I work at a vet clinic</strong>
          <span>Find a visiting pet, ask the owner for access, and add visits to the shared record.</span>
        </button>
        <button className="role" onClick={() => setRole('owner')}>
          <span className="tag">Pet owner app</span>
          <strong>I’m a pet owner</strong>
          <span>Keep your pet’s record, decide which clinic sees what and for how long, and stop sharing any time.</span>
        </button>
      </div>
    );
  }

  return (
    <div className="landing">
      {top}
      <h1>{role === 'vet' ? 'Set up your clinic' : 'Set up your account'}</h1>
      {fail && <Banner kind="err" title="Couldn’t save">{fail}</Banner>}

      <Field label="Your name" error={errors.name}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={role === 'vet' ? 'Dr. R. Kazlauskas' : 'Laura Kask'} autoComplete="name" />
      </Field>

      {role === 'vet' ? (
        <>
          <Field label="Your clinic" error={errors.clinic}>
            <select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">Choose a clinic…</option>
              {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}{c.verified ? ' ✓' : ''}</option>)}
              <option value="new">My clinic isn’t listed</option>
            </select>
          </Field>
          {clinicId === 'new' && (
            <>
              <Field label="Clinic name" error={errors.clinicName}>
                <input value={newClinic.name} onChange={(e) => setNewClinic({ ...newClinic, name: e.target.value })} />
              </Field>
              <div className="btns">
                <Field label="City"><input value={newClinic.city} onChange={(e) => setNewClinic({ ...newClinic, city: e.target.value })} /></Field>
                <Field label="Country"><input value={newClinic.country} onChange={(e) => setNewClinic({ ...newClinic, country: e.target.value })} /></Field>
              </div>
              <p className="small">New clinics start unverified. The PawFile team marks a clinic verified after checking it.</p>
            </>
          )}
        </>
      ) : (
        <>
          <Field label="Phone number (optional)">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+370 612 34 567" autoComplete="tel" />
          </Field>
          <p className="small">Vets can find your pet by microchip or by this number. They only see your first name and the last 4 digits.</p>
          {!profile.has_pin && (
            <>
              <Field label="Choose a 4-digit PIN" error={errors.pin}>
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" />
              </Field>
              <Field label="Repeat the PIN" error={errors.pin2}>
                <input value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" />
              </Field>
              <p className="small">You’ll enter this PIN to approve a clinic or create a share code. It can’t be changed in this version, so remember it.</p>
            </>
          )}
        </>
      )}

      <Btn onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Continue'}</Btn>
      {!profile.role && <Btn kind="ghost" onClick={() => setRole(null)}>‹ Choose a different role</Btn>}
    </div>
  );
}
