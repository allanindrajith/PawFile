import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { explain, rpc, run, supabase } from '../lib/supabase.js';
import { DURATIONS, ageOf, ago, digits, durLabel, fmtDate, fmtDateTime, fmtUntil, petLine, reqState, scopeLabel, vaccStatus } from '../lib/format.js';
import { Paw, Avatar, Banner, Btn, Field, Mascot, Person, Radio, Shell, icons } from '../ui.jsx';
import { uploadPetPhoto } from '../lib/photos.js';
import { useRealtime } from '../lib/realtime.js';
import { AlertsCard, PetHero, StatRow, Timeline, VaccCard } from './PetRecord.jsx';
import Profile from './Profile.jsx';
import ChatTab from './Chat.jsx';
import { liveChatApi } from '../lib/chat.js';
import { Hero, PetFeature, PromoCarousel, QuickActions, RequestList, Tiles, greeting } from './HomeParts.jsx';
import { AppointmentsCard, AuditCard, AmendBox, DocsCard, HouseholdCard, LostCard, MedsCard, RemindersCard, WeightCard, remindersFor } from './Clinical.jsx';
import { addCoowner, addMedication, addWeight, bookAppointment, loadExtras, openDocument, openPassport, setAppointment, setLost, transferPet, uploadDocument } from '../lib/clinical.js';

const TABS = [
  { id: 'home', label: 'Home', icon: icons.home },
  { id: 'chat', label: 'Messages', icon: icons.chat },
  { id: 'profile', label: 'Profile', icon: icons.profile },
];
const SCOPES = [{ id: 'full', label: 'Full health history' }, { id: 'vaccinations', label: 'Vaccinations only' }];
const PIN_MSG = { PIN_WRONG: 'That PIN isn’t right.', PIN_LOCKED: 'Too many wrong tries. Try again in 10 minutes.', PIN_NOT_SET: 'Set a PIN first.' };
const spaced = (c) => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : '');
const EMPTY_PET = { name: '', species: 'Dog', breed: '', sex: '', birth_date: '', chip: '', weight: '' };

/** Pet owner app: see your pets, answer access requests with a PIN, stop sharing, share with a one-time code. */
export default function OwnerApp({ profile, onSignOut, onRefresh }) {
  const [s, setS] = useState('home');
  const [pets, setPets] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState(null); // selected access request
  const [petId, setPetId] = useState(null);
  const [scope, setScope] = useState('full');
  const [dur, setDur] = useState('today');
  const [pin, setPin] = useState('');
  const [pinFor, setPinFor] = useState('approve'); // approve | code
  const [pinErr, setPinErr] = useState('');
  const [detail, setDetail] = useState(null); // {alerts, vaccs, visits}
  const [extras, setExtras] = useState({ meds: [], weights: [], docs: [], log: [], amends: [], appts: [] });
  const [newPet, setNewPet] = useState(EMPTY_PET);
  const [petErr, setPetErr] = useState({});
  const [allergy, setAllergy] = useState('');
  const [vacc, setVacc] = useState({ name: '', given_on: '', valid_until: '' });
  const [issued, setIssued] = useState(null); // {code, expires_at}
  const [codeRow, setCodeRow] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [newPhoto, setNewPhoto] = useState(null); // File picked on the add-pet form
  const [weight, setWeight] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        run(supabase.from('pets').select('*').order('created_at')),
        run(supabase.from('access_requests').select('*').order('created_at', { ascending: false })),
      ]);
      setPets(p); setReqs(r); setLoaded(true);
    } catch (e) { setErr(explain(e)); setLoaded(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (s === 'home' || s === 'access') load(); }, [s, load]);

  const go = (next) => { setErr(''); setS(next); };
  const guard = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(explain(e)); }
    setBusy(false);
  };

  const pet = pets.find((p) => p.id === petId) || pets[0];
  const pending = reqs.filter((r) => reqState(r) === 'pending');
  const expired = reqs.filter((r) => reqState(r) === 'expired' && r.kind === 'request');
  const active = reqs.filter((r) => reqState(r) === 'active');
  const sharedWith = (id) => new Set(active.filter((r) => r.pet_id === id).map((r) => r.clinic_id)).size;

  /* ---------- pets ---------- */
  const addPet = () => guard(async () => {
    const e = {};
    if (!newPet.name.trim()) e.name = 'Give your pet a name';
    if (newPet.chip && digits(newPet.chip).length !== 15) e.chip = 'A microchip number has exactly 15 digits';
    const w = newPet.weight ? Number(newPet.weight) : null;
    if (w != null && !(w > 0 && w < 500)) e.weight = 'Enter the weight in kg, for example 28.5';
    setPetErr(e);
    if (Object.keys(e).length) return;
    const created = await run(supabase.from('pets').insert({
      name: newPet.name.trim(), species: newPet.species || 'Dog', breed: newPet.breed.trim() || null, sex: newPet.sex || null,
      birth_date: newPet.birth_date || null, chip: digits(newPet.chip) || null, ...(w ? { weight_kg: w } : {}),
    }).select('id').single());
    let photoMsg = '';
    if (newPhoto) { try { await uploadPetPhoto(created.id, newPhoto); } catch (x) { photoMsg = explain(x); } }
    const saved = newPet.name.trim();
    setNewPet(EMPTY_PET); setNewPhoto(null); await load(); setS('home');
    if (photoMsg) setErr(`${saved} was saved, but the photo wasn’t: ${photoMsg}`);
  });

  const changePhoto = async (file) => {
    setPhotoBusy(true); setErr('');
    try { await uploadPetPhoto(pet.id, file); await load(); } catch (e) { setErr(explain(e)); }
    setPhotoBusy(false);
  };
  const saveWeight = () => guard(async () => {
    const w = Number(weight);
    if (!(w > 0 && w < 500)) { setErr('Enter the weight in kg, for example 28.5'); return; }
    await run(supabase.from('pets').update({ weight_kg: w }).eq('id', pet.id));
    setWeight(''); await load();
  });

  const openPet = (p) => guard(async () => {
    setPetId(p.id); setDetail(null);
    const [alerts, vaccs, visits] = await Promise.all([
      run(supabase.from('pet_alerts').select('*').eq('pet_id', p.id).order('created_at', { ascending: false })),
      run(supabase.from('vaccinations').select('*').eq('pet_id', p.id).order('given_on', { ascending: false })),
      run(supabase.from('visits').select('*').eq('pet_id', p.id).order('visit_date', { ascending: false })),
    ]);
    setDetail({ alerts, vaccs, visits }); setS('pet');
    setExtras(await loadExtras(p.id));
  });
  const refreshDetail = async () => {
    const [alerts, vaccs, visits] = await Promise.all([
      run(supabase.from('pet_alerts').select('*').eq('pet_id', pet.id).order('created_at', { ascending: false })),
      run(supabase.from('vaccinations').select('*').eq('pet_id', pet.id).order('given_on', { ascending: false })),
      run(supabase.from('visits').select('*').eq('pet_id', pet.id).order('visit_date', { ascending: false })),
    ]);
    setDetail({ alerts, vaccs, visits });
    setExtras(await loadExtras(pet.id));
  };
  const addAllergy = () => guard(async () => {
    if (!allergy.trim()) return;
    await run(supabase.from('pet_alerts').insert({ pet_id: pet.id, kind: 'allergy', substance: allergy.trim(), source: 'Owner' }));
    setAllergy(''); await refreshDetail();
  });
  const addVacc = () => guard(async () => {
    if (!vacc.name.trim()) return;
    await run(supabase.from('vaccinations').insert({
      pet_id: pet.id, name: vacc.name.trim(), given_on: vacc.given_on || null, valid_until: vacc.valid_until || null, clinic_name: 'Owner',
    }));
    setVacc({ name: '', given_on: '', valid_until: '' }); await refreshDetail();
  });

  /* ---------- answering a request ---------- */
  const openRequest = (r) => { setSel(r); setScope('full'); setDur('today'); setPin(''); setPinErr(''); go(reqState(r) === 'expired' ? 'expired' : 'request'); };
  const decline = () => guard(async () => { await rpc('respond_to_request', { p_request: sel.id, p_decision: 'decline', p_scope: null, p_duration: null, p_pin: null }); await load(); setS('declined'); });
  const report = () => guard(async () => { await rpc('stop_sharing', { p_request: sel.id, p_report: true }); await load(); setS('reported'); });

  const confirmPin = () => guard(async () => {
    setPinErr('');
    if (!/^\d{4}$/.test(pin)) { setPinErr('Enter your 4-digit PIN.'); return; }
    if (pinFor === 'approve') {
      const st = await rpc('respond_to_request', { p_request: sel.id, p_decision: 'approve', p_scope: scope, p_duration: dur, p_pin: pin });
      if (st !== 'ok') { setPinErr(PIN_MSG[st] || 'Could not confirm.'); setPin(''); return; }
      await load(); setPin(''); setS('approved');
    } else {
      const rows = await rpc('create_share_code', { p_pet: pet.id, p_scope: scope, p_duration: dur, p_pin: pin });
      const row = rows?.[0];
      if (!row || row.status !== 'ok') { setPinErr(PIN_MSG[row?.status] || 'Could not confirm.'); setPin(''); return; }
      setIssued(row); setCodeRow(null); setPin(''); setS('codeshow');
    }
  });

  /* ---------- stop sharing ---------- */
  const stop = () => guard(async () => { await rpc('stop_sharing', { p_request: sel.id, p_report: false }); await load(); setS('stopped'); });

  /* ---------- share with a code ---------- */
  useEffect(() => {
    if (s !== 'codeshow' || !issued) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try { setCodeRow(await run(supabase.from('share_codes').select('*').eq('code', issued.code).maybeSingle())); } catch { /* retry next tick */ }
    }, 4000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [s, issued]);

  /* ---------- live updates: a clinic asks, answers or adds a visit and this screen changes by itself ---------- */
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  const live = useRealtime('owner', ['access_requests', 'share_codes', 'visits', 'vaccinations', 'pet_alerts', 'pets', 'medications', 'weight_logs', 'pet_documents', 'appointments', 'access_log'], (table, p) => {
    load();
    if (s === 'pet' && pet) refreshDetail().catch(() => {});
    if (s === 'codeshow' && issued) run(supabase.from('share_codes').select('*').eq('code', issued.code).maybeSingle()).then(setCodeRow).catch(() => {});
    if (table === 'access_requests' && p.eventType === 'INSERT' && p.new?.status === 'pending') flash(`${p.new.requested_by_name || 'A clinic'} is asking to see ${p.new.pet_name}`);
    if (table === 'visits' && p.eventType === 'INSERT') flash('A clinic added a visit');
    if (table === 'share_codes' && p.new?.redeemed_at) flash('Your code was just used');
  });

  /* ---------- shared pieces ---------- */
  const errBanner = err && <Banner kind="err" title="That didn’t work">{err}</Banner>;
  const tab = s === 'profile' ? 'profile' : s === 'chat' ? 'chat' : 'home';
  const chatApi = useMemo(() => liveChatApi(profile), [profile.id]);
  const shell = (children, extra = {}) => (
    <Shell tabs={TABS} tab={tab} onHome={onSignOut} homeLabel="Sign out" onTab={(t) => go(t)} live={live}
      overlay={toast && <div className="toast" role="status">{toast}</div>} {...extra}>{children}</Shell>
  );
  const chips = (r) => (
    <div className="chips"><span className="chip">{scopeLabel(scope)}</span><span className="chip">{durLabel(dur)}</span></div>
  );
  const choices = (
    <>
      <p className="label">WHAT CAN THEY SEE?</p>
      {SCOPES.map((o) => <Radio key={o.id} on={scope === o.id} onClick={() => setScope(o.id)}>{o.label}</Radio>)}
      <p className="label">FOR HOW LONG?</p>
      {DURATIONS.map((o) => <Radio key={o.id} on={dur === o.id} onClick={() => setDur(o.id)}>{o.label}</Radio>)}
      <p className="label">YOU’RE ABOUT TO SHARE</p>
      {chips()}
    </>
  );

  /* ---------- screens ---------- */
  if (s === 'home') {
    return shell(
      <>
        <Hero title={`${greeting()}${profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
          line={pending.length ? `${pending.length} clinic${pending.length === 1 ? ' is' : 's are'} waiting for your answer` : pets.length ? 'All your pets’ records are up to date.' : 'Add your first pet to get started.'}
          profile={profile} onProfile={() => go('profile')} pet={pets[0]} />
        <QuickActions items={[
          { label: 'Add pet', icon: 'user', onClick: () => { setNewPet(EMPTY_PET); setPetErr({}); go('addpet'); } },
          { label: 'Share', icon: 'key', onClick: () => (pets[0] ? openPet(pets[0]) : go('addpet')) },
          { label: 'Sharing', icon: 'lock', onClick: () => go('access') },
          { label: 'Profile', icon: 'id', onClick: () => go('profile') },
        ]} />
        {errBanner}
        {!loaded && <p className="meta">Loading…</p>}
        {loaded && pets.length === 0 && (
          <div className="empty">
            <Mascot size={130} mood="wow" />
            <h2>Let’s add your first pet</h2>
            <p className="meta">Once Biscuit has your pet’s microchip, any clinic you approve can find the record.</p>
          </div>
        )}
        <RequestList onOpen={openRequest} items={[
          ...pending.map((r) => ({ ...r, title: `${r.requested_by_name || 'A clinic'} wants to see ${r.pet_name}’s record`, sub: ago(r.created_at) })),
          ...expired.map((r) => ({ ...r, title: `Request for ${r.pet_name}`, sub: `Expired · asked ${ago(r.created_at)}`, warn: false, cta: 'View' })),
        ]} />
        {pets.map((p) => (
          <PetFeature key={p.id} pet={p} onOpen={() => openPet(p)}
            badge={sharedWith(p.id) > 0 ? `Shared with ${sharedWith(p.id)} clinic${sharedWith(p.id) === 1 ? '' : 's'}` : 'Private'}
            stats={[{ v: ageOf(p.birth_date) || '—', l: 'Age' }, { v: p.weight_kg ? `${p.weight_kg} kg` : '—', l: 'Weight' }, { v: p.chip ? `…${p.chip.slice(-3)}` : '—', l: 'Chip' }]} />
        ))}
        {pets[0] && <Tiles items={[
          { label: 'Weight', value: pets[0].weight_kg ? `${pets[0].weight_kg} kg` : '—', sub: 'Latest', tone: 'g' },
          { label: 'Sharing', value: String(sharedWith(pets[0].id)), sub: 'clinics with access', tone: 'b' },
          { label: 'Requests', value: String(pending.length), sub: 'waiting', tone: 'o' },
          { label: 'Record', value: 'Secure', sub: 'PIN protected', tone: 'p' },
        ]} />}
        <PromoCarousel />
      </>,
    );
  }

  if (s === 'addpet') {
    const f = (k) => (e) => setNewPet({ ...newPet, [k]: e.target.value });
    return shell(
      <>
        <h1>Add a pet</h1>
        {errBanner}
        <div className="photo-pick">
          <span className="avatar ring" style={{ width: 112, height: 112, fontSize: 52 }}>
            {newPhoto ? <img src={URL.createObjectURL(newPhoto)} alt="Chosen pet" /> : <Paw size={48} />}
          </span>
          <label className="pickbtn">
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setNewPhoto(f); }} />
            {newPhoto ? 'Change photo' : 'Add a photo'}
          </label>
        </div>
        <Field label="Name" error={petErr.name}><input value={newPet.name} onChange={f('name')} placeholder="Max" /></Field>
        <Field label="Species"><input value={newPet.species} onChange={f('species')} /></Field>
        <Field label="Breed (optional)"><input value={newPet.breed} onChange={f('breed')} placeholder="Labrador Retriever" /></Field>
        <Field label="Sex (optional)">
          <select value={newPet.sex} onChange={f('sex')}><option value="">—</option><option>Male</option><option>Female</option></select>
        </Field>
        <Field label="Date of birth (optional)"><input type="date" value={newPet.birth_date} onChange={f('birth_date')} /></Field>
        <Field label="Weight in kg (optional)" error={petErr.weight}><input value={newPet.weight} onChange={f('weight')} inputMode="decimal" placeholder="28.5" /></Field>
        <Field label="Microchip number (15 digits)" error={petErr.chip}><input value={newPet.chip} onChange={f('chip')} inputMode="numeric" placeholder="985 141 000 447 102" /></Field>
        <p className="small">The microchip is how a vet finds your pet. They never see the record without your approval.</p>
        <Btn onClick={addPet} disabled={busy}>{busy ? 'Saving…' : 'Save pet'}</Btn>
      </>,
      { onBack: () => go('home') },
    );
  }

  if (s === 'chat') return shell(<ChatTab role="owner" api={chatApi} />);

  if (s === 'profile') {
    return shell(
      <Profile profile={profile} clinic={null} activity={reqs.slice(0, 6).map((r) => ({ id: r.id, title: `${r.requested_by_name || 'A clinic'} · ${r.pet_name}`, sub: ago(r.created_at), pill: reqState(r), warn: reqState(r) === 'pending' }))} onRefresh={onRefresh} onSignOut={onSignOut} />,
    );
  }

  if (s === 'pet') {
    const n = sharedWith(pet.id);
    return shell(
      <>
        {errBanner}
        <PetHero pet={pet} onPhoto={changePhoto} busy={photoBusy}
          badges={[
            <span key="s" className={`chip ${n ? '' : 'warn'}`}>{n ? `Shared with ${n} clinic${n === 1 ? '' : 's'}` : 'Private'}</span>,
            ...(detail?.alerts.length ? [<span key="a" className="chip danger">{detail.alerts.length} alert{detail.alerts.length === 1 ? '' : 's'}</span>] : []),
          ]} />
        <StatRow pet={pet} />
        {!detail ? <p className="meta">Loading…</p> : (
          <>
            <RemindersCard items={remindersFor(detail.vaccs, extras.meds, extras.appts)} />
            <AlertsCard alerts={detail.alerts}>
              <Field label="Add an allergy"><input value={allergy} onChange={(e) => setAllergy(e.target.value)} placeholder="Penicillin" /></Field>
              <Btn kind="secondary" onClick={addAllergy} disabled={busy || !allergy.trim()}>Add allergy</Btn>
            </AlertsCard>
            <VaccCard vaccs={detail.vaccs}>
              <Field label="Vaccine"><input value={vacc.name} onChange={(e) => setVacc({ ...vacc, name: e.target.value })} placeholder="Rabies" /></Field>
              <div className="btns">
                <Field label="Given on"><input type="date" value={vacc.given_on} onChange={(e) => setVacc({ ...vacc, given_on: e.target.value })} /></Field>
                <Field label="Valid until"><input type="date" value={vacc.valid_until} onChange={(e) => setVacc({ ...vacc, valid_until: e.target.value })} /></Field>
              </div>
              <Btn kind="secondary" onClick={addVacc} disabled={busy || !vacc.name.trim()}>Add vaccination</Btn>
            </VaccCard>
            <Timeline visits={detail.visits} extra={(v) => <AmendBox visit={v} amendments={extras.amends} />} />
            <MedsCard meds={extras.meds} canEdit onAdd={async (m) => { await addMedication(pet.id, m); await refreshDetail(); }} />
            <WeightCard logs={extras.weights} canEdit onAdd={async (kg) => {
              try { await addWeight(pet.id, kg); } catch (e) {
                // before upgrade-02 is applied there is no history table: fall back to the single weight field
                if (!/add_weight|function/i.test(String(e?.message))) throw e;
                await run(supabase.from('pets').update({ weight_kg: kg }).eq('id', pet.id));
              }
              await load(); await refreshDetail();
            }} />
            <DocsCard docs={extras.docs} canEdit onOpen={openDocument}
              onUpload={async (file, kind) => { await uploadDocument(pet.id, file, kind, file.name.replace(/\.[^.]+$/, '')); await refreshDetail(); }} />
            <AppointmentsCard appts={extras.appts} who="owner" onStatus={async (id, st) => { await setAppointment(id, st); await refreshDetail(); }} />
            <AuditCard log={extras.log} title="Who has opened this record" />
            <HouseholdCard pet={pet} onAdd={(email) => addCoowner(pet.id, email)}
              onTransfer={async (email, pin) => { const r = await transferPet(pet.id, email, pin); if (r === 'ok') { await load(); go('home'); } return r; }} />
            <LostCard pet={pet} onToggle={async (lost, note) => { await setLost(pet.id, lost, note); await load(); }} />
            <Btn kind="outline" onClick={() => openPassport(pet, detail.vaccs, extras.meds, detail.visits, profile.full_name)}>Print health summary (PDF)</Btn>
          </>
        )}
        <Btn onClick={() => { setScope('full'); setDur('today'); setPinFor('code'); go('code'); }}>Share with a code</Btn>
      </>,
      { onBack: () => go('home') },
    );
  }

  if (s === 'request') {
    return shell(
      <>
        <h1>{sel.requested_by_name || 'A clinic'} wants to see {sel.pet_name}’s record</h1>
        <p className="meta">Asked {ago(sel.created_at)}. Nothing is shared until you approve.</p>
        {errBanner}
        {choices}
        <div className="btns">
          <Btn onClick={() => { setPinFor('approve'); setPin(''); setPinErr(''); go('pin'); }}>Approve</Btn>
          <Btn kind="secondary" onClick={decline} disabled={busy}>Decline</Btn>
        </div>
        <button className="home-link left" onClick={report} disabled={busy}>I don’t know this clinic</button>
      </>,
      { onBack: () => go('home') },
    );
  }

  if (s === 'expired') {
    return shell(
      <>
        <h1>This request expired</h1>
        <Banner kind="warn" title={`${sel.requested_by_name || 'The clinic'} asked ${ago(sel.created_at)}`}>Requests last 24 hours. Ask them to send a new one, or give them a one-time code now.</Banner>
        <Btn onClick={() => { setPetId(sel.pet_id); setScope('full'); setDur('today'); setPinFor('code'); go('code'); }}>Share with a code instead</Btn>
        <Btn kind="ghost" onClick={() => go('home')}>Back to home</Btn>
      </>,
      { onBack: () => go('home') },
    );
  }

  if (s === 'pin' || s === 'codepin') {
    return shell(
      <>
        <h1>Enter your PawFile PIN</h1>
        <p className="meta">{pinFor === 'approve' ? `To share ${sel.pet_name} with ${sel.requested_by_name || 'this clinic'}.` : `To create a code for ${pet.name}.`}</p>
        <Field label="4-digit PIN" error={pinErr}>
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={(e) => e.key === 'Enter' && confirmPin()}
            type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="PIN" />
        </Field>
        {errBanner}
        <Btn onClick={confirmPin} disabled={busy || pin.length !== 4}>{busy ? 'Checking…' : 'Confirm'}</Btn>
      </>,
      { onBack: () => go(pinFor === 'approve' ? 'request' : 'code') },
    );
  }

  if (s === 'approved') {
    return shell(
      <>
        <div className="big-check">✓</div>
        <h1>Access approved</h1>
        <Banner kind="ok" title={`${sel.requested_by_name || 'The clinic'} can now see ${sel.pet_name}’s record`}>
          {scopeLabel(scope)} · {durLabel(dur)}. You can stop sharing at any time.
        </Banner>
        <Btn onClick={() => go('home')}>Back to home</Btn>
        <Btn kind="secondary" onClick={() => go('access')}>Who can see {sel.pet_name}’s record</Btn>
      </>,
    );
  }

  if (s === 'declined' || s === 'reported') {
    return shell(
      <>
        <h1>{s === 'declined' ? 'Request declined' : 'Clinic reported'}</h1>
        <Banner kind={s === 'declined' ? 'info' : 'warn'} title={s === 'declined' ? 'Nothing was shared' : 'Request blocked'}>
          {s === 'declined' ? ' The clinic is told you declined. They can’t see anything.' : ' Nothing was shared, and the PawFile team will check this clinic.'}
        </Banner>
        <Btn onClick={() => go('home')}>Back to home</Btn>
      </>,
    );
  }

  if (s === 'access') {
    return shell(
      <>
        <h1>Who has access</h1>
        <p className="meta">Everyone who can open your pets’ records, what they can see and for how long.</p>
        {errBanner}
        {active.length === 0 && <p className="meta">No clinic has access right now.</p>}
        {active.length > 0 && (
          <div className="group">
            {active.map((r) => (
              <div key={r.id} className="acc-row">
                <Person profile={{ full_name: r.requested_by_name || 'Clinic' }} size={42} />
                <span className="row-main">
                  <b>{r.requested_by_name || 'A clinic'}</b>
                  <small>Veterinarian · for {r.pet_name}</small>
                  <small>{scopeLabel(r.scope)} · until {fmtUntil(r.expires_at)}{r.kind === 'emergency' ? ' · Emergency access' : r.kind === 'code' ? ' · Via code' : ''}</small>
                  {r.reason && <small>Reason: {r.reason}</small>}
                  <button className="link-row quiet" onClick={() => { setSel(r); go('stop'); }}>Stop sharing</button>
                </span>
                <span className="pill">Active</span>
              </div>
            ))}
          </div>
        )}
        {pets.length > 0 && <Btn onClick={() => { setPetId(pets[0].id); setScope('full'); setDur('today'); setPinFor('code'); go('code'); }}>Share with a code</Btn>}
      </>,
    );
  }

  if (s === 'stop') {
    return shell(
      <>
        <h1>Stop sharing {sel.pet_name}’s record?</h1>
        {errBanner}
        <Banner kind="warn" title={`${sel.requested_by_name || 'This clinic'} will lose access straight away`}>Anything they already saw stays in their own files, but they can’t open the record again unless you approve a new request.</Banner>
        <Btn kind="danger" onClick={stop} disabled={busy}>Stop sharing</Btn>
        <Btn kind="secondary" onClick={() => go('access')}>Keep sharing</Btn>
      </>,
      { onBack: () => go('access') },
    );
  }

  if (s === 'stopped') {
    return shell(
      <>
        <div className="big-check">✓</div>
        <h1>Access revoked</h1>
        <Banner kind="ok" title="Done">{sel.requested_by_name || 'The clinic'} can no longer see {sel.pet_name}’s record.</Banner>
        <Btn onClick={() => go('home')}>Back to home</Btn>
      </>,
    );
  }

  if (s === 'code') {
    return shell(
      <>
        <h1>Share with a code</h1>
        <p className="meta">A one-time code lets a clinic open {pet.name}’s record without waiting for a request. It works once, for 10 minutes.</p>
        {pets.length > 1 && (
          <Field label="Which pet?">
            <select value={pet.id} onChange={(e) => setPetId(e.target.value)}>{pets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
        )}
        {choices}
        <Btn onClick={() => { setPinFor('code'); setPin(''); setPinErr(''); go('codepin'); }}>Create code</Btn>
      </>,
      { onBack: () => go('home') },
    );
  }

  // codeshow
  const left = Math.max(0, Math.floor((new Date(issued.expires_at).getTime() - now) / 1000));
  const used = codeRow?.redeemed_at;
  return shell(
    <>
      <h1>Share {pet.name}’s record</h1>
      {used ? (
        <Banner kind="ok" title="Code accepted">{codeRow.redeemed_clinic || 'A clinic'} used your code. They can see {pet.name}’s {scope === 'full' ? 'full history' : 'vaccinations'} ({durLabel(dur)}). You can stop sharing under Access.</Banner>
      ) : left > 0 ? (
        <>
          <p className="meta">Read this code to the clinic:</p>
          <div className="code" aria-live="polite">{spaced(issued.code)}</div>
          <p className="meta">Valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · {scopeLabel(scope)} · {durLabel(dur)}</p>
          <p className="small">Created {fmtDateTime(new Date(issued.expires_at).getTime() - 600000)}. We’ll tell you here when it’s used.</p>
        </>
      ) : (
        <Banner kind="warn" title="This code has expired">Nobody used it. Create a new one if you still want to share.</Banner>
      )}
      <Btn onClick={() => go('home')}>Back to home</Btn>
      {!used && left === 0 && <Btn kind="secondary" onClick={() => go('code')}>Create a new code</Btn>}
    </>,
  );
}
