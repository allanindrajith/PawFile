import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { explain, isOffline, rpc, run, supabase } from '../lib/supabase.js';
import { ago, digits, fmtDate, fmtUntil, petLine, reqState, scopeLabel, vaccStatus } from '../lib/format.js';
import { Avatar, Banner, Btn, Field, Person, Shell, icons } from '../ui.jsx';
import { useRealtime } from '../lib/realtime.js';
import { AlertsCard, PetHero, StatRow, Timeline, VaccCard } from './PetRecord.jsx';
import Profile from './Profile.jsx';
import ChatTab from './Chat.jsx';
import { liveChatApi } from '../lib/chat.js';
import { Hero, QuickActions, RequestList, Tiles } from './HomeParts.jsx';
import { AmendBox, AppointmentsCard, AuditCard, CredentialCard, DocsCard, MedsCard, RemindersCard, WeightCard, remindersFor } from './Clinical.jsx';
import { addMedication, addWeight, amendVisit, bookAppointment, loadExtras, logView, openDocument, openPassport, setAppointment, submitCredential, uploadDocument } from '../lib/clinical.js';
import { queueVisit, useOutbox } from '../lib/offline.js';

const TABS = [
  { id: 'today', label: 'Today', icon: icons.today },
  { id: 'visit', label: 'New visit', icon: icons.visit },
  { id: 'chat', label: 'Messages', icon: icons.chat },
  { id: 'profile', label: 'Profile', icon: icons.profile },
];
const VISIT_SCREENS = ['form', 'conflict', 'review', 'syncfail', 'saved', 'novisit'];
const EMPTY = { reason: '', diagnosis: '', treatment: '', vaccine: '', batch: '', next: '' };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Vet clinic app: find a pet, get access, read the record, add a visit. All rules are enforced by the database. */
export default function VetApp({ profile, onSignOut, onRefresh }) {
  const [s, setS] = useState('today');
  const [clinic, setClinic] = useState(null);
  const [recent, setRecent] = useState([]);
  const [query, setQuery] = useState('');
  const [queryErr, setQueryErr] = useState('');
  const [matches, setMatches] = useState(null); // null = not searched yet
  const [pet, setPet] = useState(null); // identity from find_pet, or {id, name}
  const [req, setReq] = useState(null); // latest access request for this pet + my clinic
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [emReason, setEmReason] = useState('');
  const [emOk, setEmOk] = useState(false);
  const [data, setData] = useState(null); // {pet, alerts, vaccs, visits}
  const [asked, setAsked] = useState({});
  const [form, setForm] = useState(EMPTY);
  const [formErr, setFormErr] = useState({});
  const [conflict, setConflict] = useState('');
  const [override, setOverride] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const first = (profile.full_name || '').split(' ').slice(-1)[0];

  const loadRecent = useCallback(async () => {
    try {
      const rows = await run(supabase.from('access_requests').select('*').order('created_at', { ascending: false }).limit(30));
      setRecent(rows.filter((r) => ['active', 'pending'].includes(reqState(r))));
    } catch (e) { setErr(explain(e)); }
  }, []);

  useEffect(() => {
    run(supabase.from('clinics').select('name,city,verified').eq('id', profile.clinic_id).single()).then(setClinic).catch(() => {});
  }, [profile.clinic_id]);
  useEffect(() => { if (s === 'today') loadRecent(); }, [s, loadRecent]);

  const go = (next) => { setErr(''); setS(next); };
  const guard = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(explain(e)); }
    setBusy(false);
  };

  /* ---------- finding a pet ---------- */
  const search = () => guard(async () => {
    setQueryErr('');
    if (digits(query).length < 7) { setQueryErr('Enter the 15-digit microchip, or the owner’s phone number.'); return; }
    const rows = await rpc('find_pet', { p_query: query });
    setMatches(rows);
    if (rows.length === 0) setS('nomatch');
    else if (rows.length === 1) await openPet(rows[0]);
    else setS('pick');
  });

  const openPet = async (p) => {
    const rows = await run(supabase.from('access_requests').select('*').eq('pet_id', p.id).order('created_at', { ascending: false }).limit(10));
    const live = rows.find((r) => ['active', 'pending'].includes(reqState(r)));
    setPet(p); setReq(live || rows[0] || null);
    setS(live ? (reqState(live) === 'active' ? 'record' : 'waiting') : 'found');
  };

  const openRecent = (r) => guard(async () => {
    setPet({ id: r.pet_id, name: r.pet_name }); setReq(r);
    setS(reqState(r) === 'active' ? 'record' : 'waiting');
  });

  /* ---------- getting access ---------- */
  const requestAccess = () => guard(async () => {
    const id = await rpc('request_access', { p_pet: pet.id });
    setReq(await run(supabase.from('access_requests').select('*').eq('id', id).single()));
    setS('waiting');
  });

  const redeem = () => guard(async () => {
    setCodeErr('');
    if (digits(code).length !== 6) { setCodeErr('The code has 6 digits.'); return; }
    const res = await rpc('redeem_code', { p_code: code });
    if (res.status === 'CODE_LOCKED') { setCodeErr('Too many wrong codes. Try again in 10 minutes.'); return; }
    if (res.status !== 'ok') { setCodeErr('That code isn’t valid, or it has expired. Ask the owner for a new one.'); return; }
    const r = await run(supabase.from('access_requests').select('*').eq('id', res.request_id).single());
    setPet({ id: res.pet_id, name: r.pet_name }); setReq(r); setCode(''); setS('record');
  });

  const emergency = () => guard(async () => {
    if (emReason.trim().length < 10) { setErr('Please describe the emergency (at least 10 characters).'); return; }
    const id = await rpc('emergency_access', { p_pet: pet.id, p_reason: emReason });
    setReq(await run(supabase.from('access_requests').select('*').eq('id', id).single()));
    setEmReason(''); setEmOk(false); setS('record');
  });

  // While waiting for the owner, check for an answer every 4 seconds.
  useEffect(() => {
    if (s !== 'waiting' || !req) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await run(supabase.from('access_requests').select('*').eq('id', req.id).single());
        setReq(r);
        if (reqState(r) === 'active') setS('record');
      } catch { /* keep waiting; the next tick retries */ }
    }, 4000);
    return () => clearInterval(t);
  }, [s, req]);

  /* ---------- reading the record ---------- */
  const loadRecord = useCallback(async () => {
    if (!pet) return;
    try {
      const fresh = await run(supabase.from('access_requests').select('*').eq('id', req.id).single());
      setReq(fresh);
      if (reqState(fresh) !== 'active') { setErr('Your access to this record has ended.'); setS('found'); return; }
      const [p, alerts, vaccs, visits] = await Promise.all([
        run(supabase.from('pets').select('*').eq('id', pet.id).single()),
        run(supabase.from('pet_alerts').select('*').eq('pet_id', pet.id).order('created_at', { ascending: false })),
        run(supabase.from('vaccinations').select('*').eq('pet_id', pet.id).order('given_on', { ascending: false })),
        run(supabase.from('visits').select('*').eq('pet_id', pet.id).order('visit_date', { ascending: false })),
      ]);
      setData({ pet: p, alerts, vaccs, visits });
      loadExtras(pet.id).then(setExtras);
    } catch (e) { setErr(explain(e)); }
  }, [pet, req]);
  useEffect(() => { if (s === 'record') { setData(null); loadRecord(); if (pet) logView(pet.id); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const askMissing = (visitId) => guard(async () => {
    await rpc('request_missing_data', { p_pet: pet.id, p_visit: visitId, p_note: 'Lab results missing from this visit' });
    setAsked((a) => ({ ...a, [visitId]: true }));
  });

  /* ---------- adding a visit ---------- */
  const startVisit = () => { setForm(EMPTY); setFormErr({}); setConflict(''); setOverride(''); setAck(false); go('form'); };
  const canVisit = pet && req && reqState(req) === 'active';
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const review = () => guard(async () => {
    const e = {};
    if (!form.diagnosis.trim()) e.diagnosis = 'Diagnosis is required';
    if (form.vaccine.trim() && !form.batch.trim()) e.batch = 'Batch number is required when a vaccine is given';
    setFormErr(e);
    if (Object.keys(e).length) return;
    const hit = form.treatment.trim() ? await rpc('check_allergy', { p_pet: pet.id, p_treatment: form.treatment }) : null;
    if (hit) { setConflict(hit); setOverride(''); setAck(false); setS('conflict'); } else { setConflict(''); setS('review'); }
  });

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await rpc('add_visit', {
        p_pet: pet.id, p_reason: form.reason || null, p_diagnosis: form.diagnosis, p_treatment: form.treatment || null,
        p_vaccine: form.vaccine || null, p_batch: form.batch || null, p_next_due: form.next || null,
        p_override: conflict ? override : null,
      });
      setS('saved');
    } catch (e) {
      if (isOffline(e)) {
        queueVisit({
          p_pet: pet.id, p_reason: form.reason || null, p_diagnosis: form.diagnosis, p_treatment: form.treatment || null,
          p_vaccine: form.vaccine || null, p_batch: form.batch || null, p_next_due: form.next || null, p_override: conflict ? override : null,
        }, `${pet.name}: ${form.diagnosis}`);
        setS('syncfail');
      }
      else if (String(e?.message).includes('ALLERGY_CONFLICT')) { setConflict(String(e.message).split('ALLERGY_CONFLICT:')[1] || 'a recorded allergy'); setS('conflict'); }
      else setErr(explain(e));
    }
    setBusy(false);
  };

  /* ---------- shared pieces ---------- */
  const errBanner = err && <Banner kind="err" title="That didn’t work">{err}</Banner>;
  const codeBox = (
    <div className="card">
      <b>Owner gave you a code?</b>
      <Field label="6-digit code" error={codeErr}>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))} inputMode="numeric" placeholder="482 913" aria-label="6-digit share code" />
      </Field>
      <Btn kind="secondary" onClick={redeem} disabled={busy}>Unlock with code</Btn>
    </div>
  );
  const [toast, setToast] = useState('');
  const [extras, setExtras] = useState({ meds: [], weights: [], docs: [], log: [], amends: [], appts: [] });
  const [cred, setCred] = useState(null);
  const loadCred = useCallback(() => run(supabase.from('vet_credentials').select('*').eq('user_id', profile.id).maybeSingle()).then(setCred).catch(() => setCred(null)), [profile.id]);
  useEffect(() => { loadCred(); }, [loadCred]);
  const verified = cred?.status === 'verified' && !!clinic?.verified;
  const outbox = useOutbox(() => { flash('Saved visits synced'); if (s === 'record') loadRecord(); });
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  // Live: when an owner approves, declines or stops sharing, this screen updates without a refresh.
  const live = useRealtime('vet', ['access_requests', 'visits', 'vaccinations', 'pet_alerts', 'medications', 'weight_logs', 'pet_documents', 'appointments', 'access_log', 'visit_amendments', 'vet_credentials'], (table, p) => {
    if (table === 'vet_credentials') loadCred();
    if (s === 'today') loadRecent();
    if (s === 'record') loadRecord();
    if (table === 'access_requests' && p.eventType === 'UPDATE' && p.new?.status === 'approved') flash(`${p.new.pet_name}’s owner approved your request`);
    if (table === 'access_requests' && p.eventType === 'UPDATE' && ['declined', 'revoked', 'reported'].includes(p.new?.status)) flash(`Access to ${p.new.pet_name} ended`);
  });
  const chatApi = useMemo(() => liveChatApi(profile), [profile.id]);
  const shell = (children, extra = {}) => (
    <Shell tabs={TABS} tab={s === 'profile' ? 'profile' : s === 'chat' ? 'chat' : VISIT_SCREENS.includes(s) ? 'visit' : 'today'} onHome={onSignOut} homeLabel="Sign out" live={live}
      overlay={toast && <div className="toast" role="status">{toast}</div>}
      banner={outbox > 0 ? <div className="outbox" role="status">Waiting for a connection: {outbox} visit{outbox === 1 ? '' : 's'} saved on this device</div> : null}
      onTab={(t) => (t === 'today' ? go('today') : t === 'profile' ? go('profile') : t === 'chat' ? go('chat') : canVisit ? startVisit() : go('novisit'))} {...extra}>
      {children}
    </Shell>
  );
  const petHead = pet && (
    <>
      <h1>{pet.name}</h1>
      {pet.species && <p className="meta">{petLine(pet)}</p>}
    </>
  );

  /* ---------- screens ---------- */
  if (s === 'chat') return shell(<ChatTab role="vet" api={chatApi} />);

  if (s === 'profile') {
    return shell(<Profile extra={<CredentialCard cred={cred} onSubmit={async (l, i) => { await submitCredential(l, i); await loadCred(); }} />} profile={profile} clinic={clinic} activity={recent.slice(0, 6).map((r) => ({ id: r.id, title: r.pet_name, sub: ago(r.created_at), pill: reqState(r), warn: reqState(r) === 'pending' }))} onRefresh={onRefresh} onSignOut={onSignOut} />);
  }

  if (s === 'today') {
    return shell(
      <>
        <Hero title={`${greeting()}${first ? `, Dr. ${first}` : ''}`}
          line={clinic ? `${clinic.name}${clinic.city ? ` · ${clinic.city}` : ''}${clinic.verified ? ' · Verified clinic' : ' · Not yet verified'}` : 'Find a pet to open their record'}
          profile={profile} onProfile={() => go('profile')} />
        <QuickActions items={[
          { label: 'Find pet', icon: 'user', onClick: () => document.getElementById('q')?.focus() },
          { label: 'New visit', icon: 'clipboard', onClick: () => (canVisit ? startVisit() : go('novisit')) },
          { label: 'Open records', icon: 'key', onClick: () => document.getElementById('open-records')?.scrollIntoView({ behavior: 'smooth' }) },
          { label: 'Profile', icon: 'id', onClick: () => go('profile') },
        ]} />
        {errBanner}
        <div className="card">
          <b>Find a pet</b>
          <Field label="Microchip number or owner’s phone" error={queryErr}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
              inputMode="tel" placeholder="985 141 000 447 102" aria-label="Microchip number or owner’s phone number" />
          </Field>
          <Btn onClick={search} disabled={busy}>{busy ? 'Searching…' : 'Search'}</Btn>
          <p className="small">The microchip is the most reliable. Names are never searched, so you can’t open the wrong dog.</p>
        </div>
        {codeBox}
        <Tiles title="Your day" items={[
          { label: 'Open records', value: String(recent.filter((r) => reqState(r) === 'active').length), sub: 'you can read now', tone: 'g' },
          { label: 'Waiting', value: String(recent.filter((r) => reqState(r) === 'pending').length), sub: 'for owner approval', tone: 'o' },
          { label: 'Licence', value: verified ? 'Verified' : cred?.status === 'pending' ? 'In review' : 'Not added', sub: 'needed to add visits', tone: 'b' },
          { label: 'Clinic', value: clinic?.verified ? 'Verified' : 'Pending', sub: clinic?.name || '—', tone: 'p' },
        ]} />
        <div id="open-records" />
        {recent.length === 0
          ? <p className="meta">Nothing open yet. Records you have access to appear here.</p>
          : <RequestList title="Open records" icon="clipboard" onOpen={(r) => openRecent(r)}
              items={recent.map((r) => ({ ...r, title: r.pet_name, sub: reqState(r) === 'pending' ? `Waiting for owner · asked ${ago(r.created_at)}` : `${scopeLabel(r.scope)} · until ${fmtUntil(r.expires_at)}`, warn: reqState(r) === 'pending', cta: reqState(r) === 'pending' ? 'Pending' : r.kind === 'emergency' ? 'Emergency' : 'Open' }))} />}
      </>,
    );
  }

  if (s === 'nomatch') {
    return shell(
      <>
        <h1>No pet found</h1>
        <Banner kind="warn" title={`Nothing matches “${query}”`}>
          Check the number, or ask the owner whether they have a PawFile account with that phone number or microchip.
        </Banner>
        <Btn onClick={() => go('today')}>Search again</Btn>
        {codeBox}
      </>,
      { onBack: () => go('today') },
    );
  }

  if (s === 'pick') {
    return shell(
      <>
        <h1>Which pet?</h1>
        <p className="meta">More than one pet matches that number.</p>
        {matches.map((m) => (
          <button key={m.id} className="list-item" onClick={() => guard(() => openPet(m))}>
            <span><b>{m.name}</b><br /><span className="meta">{petLine(m)} · Owner {m.owner_first_name}</span></span>
          </button>
        ))}
      </>,
      { onBack: () => go('today') },
    );
  }

  if (s === 'found') {
    const ended = req && ['declined', 'revoked', 'reported', 'ended', 'expired'].includes(reqState(req));
    return shell(
      <>
        <div className="greet" style={{ justifyContent: 'flex-start' }}>
          <Avatar pet={pet} size={72} ring />
          <div>{petHead}</div>
        </div>
        <p className="meta">Owner {pet.owner_first_name} {pet.owner_phone_hint ? `· ${pet.owner_phone_hint}` : ''}{pet.latest_clinic ? ` · Last seen at ${pet.latest_clinic}` : ''}</p>
        {errBanner}
        <Banner kind="warn" title="The owner hasn’t shared this record with your clinic">
          {ended ? ` Your last request was ${reqState(req) === 'expired' ? 'not answered in time' : reqState(req)}. You can ask again.` : ' Ask for access, and the owner decides what you see and for how long.'}
        </Banner>
        <Btn onClick={requestAccess} disabled={busy}>Request access from owner</Btn>
        <Btn kind="secondary" onClick={() => { setEmReason(''); setEmOk(false); go('emergency'); }}>Emergency access</Btn>
        {codeBox}
      </>,
      { onBack: () => go('today') },
    );
  }

  if (s === 'waiting') {
    const st = req ? reqState(req) : 'pending';
    return shell(
      <>
        <h1>{st === 'pending' ? 'Access requested' : st === 'declined' ? 'Request declined' : 'Request ended'}</h1>
        {errBanner}
        {st === 'pending' && <Banner kind="info" title={`${pet.name}’s owner has been asked`}>We’ll open the record the moment they approve. This screen checks every few seconds. Requests expire after 24 hours.</Banner>}
        {st === 'declined' && <Banner kind="err" title="The owner declined">You can’t see this record. If it’s urgent, use emergency access.</Banner>}
        {!['pending', 'declined'].includes(st) && <Banner kind="warn" title="This request is no longer active">Send a new request to ask again.</Banner>}
        {st !== 'pending' && <Btn onClick={requestAccess} disabled={busy}>Send a new request</Btn>}
        <Btn kind="secondary" onClick={() => { setEmReason(''); setEmOk(false); go('emergency'); }}>Emergency access</Btn>
        {codeBox}
      </>,
      { onBack: () => go('today') },
    );
  }

  if (s === 'emergency') {
    return shell(
      <>
        <h1>Emergency access</h1>
        {errBanner}
        <Banner kind="warn" title="The owner can see this, and it is logged">Use this only when waiting would put the animal at risk. You get the full record for 4 hours.</Banner>
        <Field label="What is the emergency?">
          <textarea rows={4} value={emReason} onChange={(e) => setEmReason(e.target.value)} placeholder="e.g. Collapsed after a bite, owner can’t be reached" />
        </Field>
        <label className="check"><input type="checkbox" checked={emOk} onChange={(e) => setEmOk(e.target.checked)} /> I confirm this is a genuine emergency and I’m responsible for this access.</label>
        <Btn kind="danger" onClick={emergency} disabled={!emOk || busy}>Open record for 4 hours</Btn>
      </>,
      { onBack: () => go(req && reqState(req) === 'pending' ? 'waiting' : 'found') },
    );
  }

  if (s === 'record') {
    const emerg = req?.kind === 'emergency';
    const full = req?.scope === 'full';
    return shell(
      <>
        {errBanner}
        <Banner kind={emerg ? 'warn' : 'ok'} title={emerg ? `Emergency access until ${fmtUntil(req.expires_at)}` : `Access granted until ${fmtUntil(req?.expires_at)}`}>
          {emerg ? ' The owner can see this in their app. Access ends automatically.' : ` ${scopeLabel(req?.scope)}. The owner can stop sharing at any time.`}
        </Banner>
        {!data ? <p className="meta">Loading the record…</p> : (
          <>
            <PetHero pet={data.pet} badges={[<span key="s" className="chip">{full ? 'Full history' : 'Vaccinations only'}</span>, ...(data.alerts.length ? [<span key="a" className="chip danger">{data.alerts.length} alert{data.alerts.length === 1 ? '' : 's'}</span>] : [])]} />
            <StatRow pet={data.pet} />
            <RemindersCard items={remindersFor(data.vaccs, extras.meds, extras.appts)} />
            {!verified && <Banner kind="warn" title="Read-only until your licence is verified">Add your licence on the Profile tab. Clinical writes are blocked until it is approved.</Banner>}
            <AlertsCard alerts={data.alerts} />
            <VaccCard vaccs={data.vaccs} />
            {full && <>
              <MedsCard meds={extras.meds} canEdit={verified} onAdd={async (m) => { await addMedication(pet.id, m); await loadRecord(); }} />
              <WeightCard logs={extras.weights} canEdit={verified} onAdd={async (kg) => { await addWeight(pet.id, kg); await loadRecord(); }} />
              <DocsCard docs={extras.docs} canEdit={verified} onOpen={openDocument}
                onUpload={async (file, kind) => { await uploadDocument(pet.id, file, kind, file.name.replace(/\.[^.]+$/, '')); await loadRecord(); }} />
              <AppointmentsCard appts={extras.appts} canBook={verified && !!profile.clinic_id}
                onBook={async (at, reason) => { await bookAppointment(pet.id, profile.clinic_id, at, reason); await loadRecord(); }}
                onStatus={async (id, st) => { await setAppointment(id, st); await loadRecord(); }} />
            </>}
            {full ? (
              <Timeline visits={data.visits} empty="No visits yet. Yours will be the first."
                extra={(v) => <>{verified && <AmendBox visit={v} amendments={extras.amends} onSave={async (id, dx, tx, why) => { await amendVisit(id, dx, tx, why); await loadRecord(); }} />}{!verified && <AmendBox visit={v} amendments={extras.amends} />}{v.lab_missing && (asked[v.id]
                  ? <Banner kind="ok" title={`Request sent to ${v.clinic_name}`}>They’ll add the results when they can.</Banner>
                  : <button className="link-row" onClick={() => askMissing(v.id)} disabled={busy}>Lab results missing · Request them</button>)}</>} />
            ) : <Banner kind="info" title="Vaccinations only">The owner chose not to share visit history.</Banner>}
            {full && <AuditCard log={extras.log} title="Access history" />}
            {full && <Btn kind="outline" onClick={() => openPassport(data.pet, data.vaccs, extras.meds, data.visits, profile.full_name)}>Print health summary</Btn>}
            <Btn onClick={startVisit} disabled={!verified}>{verified ? 'Add a visit' : 'Add a visit (licence needed)'}</Btn>
          </>
        )}
      </>,
      { onBack: () => go('today') },
    );
  }

  if (s === 'novisit') {
    return shell(
      <>
        <h1>New visit note</h1>
        <Banner kind="info" title="Open a record first">A visit is added to a pet’s shared record, so find the pet and get access before writing the note.</Banner>
        <Btn onClick={() => go('today')}>Find a pet</Btn>
      </>,
    );
  }

  if (s === 'form') {
    return shell(
      <>
        <h1>New visit note</h1>
        <p className="meta">{pet.name} · {clinic?.name}</p>
        {errBanner}
        <Field label="Reason for visit"><input value={form.reason} onChange={set('reason')} placeholder="Annual check-up" /></Field>
        <Field label="Diagnosis" error={formErr.diagnosis}><input value={form.diagnosis} onChange={set('diagnosis')} placeholder="Ear infection" /></Field>
        <Field label="Treatment"><input value={form.treatment} onChange={set('treatment')} placeholder="Drug, dose, how long" /></Field>
        <Field label="Vaccine given (optional)"><input value={form.vaccine} onChange={set('vaccine')} placeholder="DHPP" /></Field>
        <Field label="Vaccine batch number" error={formErr.batch}><input value={form.batch} onChange={set('batch')} placeholder="DH-2291" /></Field>
        <Field label="Next due (optional)"><input type="date" value={form.next} onChange={set('next')} /></Field>
        <Btn onClick={review} disabled={busy}>{busy ? 'Checking…' : 'Review before sharing'}</Btn>
      </>,
      { onBack: () => go('record') },
    );
  }

  if (s === 'conflict') {
    return shell(
      <>
        <h1>Allergy warning</h1>
        <Banner kind="err" title={`${pet.name} has a recorded ${conflict} allergy`}>
          “{form.treatment}” is in the same family. Recorded by another clinic.
        </Banner>
        <Btn onClick={() => go('form')}>Change the treatment</Btn>
        <h2>Or keep it, with a reason</h2>
        <Field label="Why is this treatment still right?">
          <textarea rows={3} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. Allergy was never confirmed; owner informed" />
        </Field>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I’ve weighed the allergy and I’m responsible for this decision.</label>
        <Btn kind="danger" onClick={() => go('review')} disabled={!ack || override.trim().length < 5}>Keep it and continue</Btn>
      </>,
      { onBack: () => go('form') },
    );
  }

  if (s === 'review') {
    return shell(
      <>
        <h1>Check before sharing</h1>
        {errBanner}
        {conflict && <Banner kind="warn" title="Allergy warning overridden">Your reason is saved with the visit: “{override}”</Banner>}
        <div className="card">
          <p><b>{fmtDate(new Date())} · {clinic?.name}</b></p>
          {form.reason && <p>Reason: {form.reason}</p>}
          <p>Diagnosis: {form.diagnosis}</p>
          {form.treatment && <p>Treatment: {form.treatment}</p>}
          {form.vaccine && <p>Vaccine: {form.vaccine} · batch {form.batch}{form.next ? ` · next due ${fmtDate(form.next)}` : ''}</p>}
        </div>
        <p className="meta">This is added to {pet.name}’s shared record. The owner and any clinic they approve can read it. It can’t be edited afterwards.</p>
        <Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Confirm and share'}</Btn>
        <Btn kind="ghost" onClick={() => go('form')}>Edit</Btn>
      </>,
      { onBack: () => go('form') },
    );
  }

  if (s === 'syncfail') {
    return shell(
      <>
        <h1>Couldn’t reach PawFile</h1>
        <Banner kind="err" title="Not saved yet">You seem to be offline. Your note is kept on this screen, so don’t close the page. Try again when you have a connection.</Banner>
        <span className="pill warn">Waiting to sync (1)</span>
        <Btn onClick={save} disabled={busy}>{busy ? 'Trying…' : 'Try again now'}</Btn>
      </>,
    );
  }

  // saved
  return shell(
    <>
      <div className="big-check">✓</div>
      <h1>Visit saved and shared</h1>
      <p className="meta">It’s now part of {pet.name}’s record.</p>
      <Btn onClick={() => go('record')}>Back to {pet.name}</Btn>
      <Btn kind="secondary" onClick={() => go('today')}>Back to today</Btn>
    </>,
  );
}
