import React, { useCallback, useEffect, useState } from 'react';
import { explain, isOffline, rpc, run, supabase } from '../lib/supabase.js';
import { ago, digits, fmtDate, fmtUntil, petLine, reqState, scopeLabel, vaccStatus } from '../lib/format.js';
import { Banner, Btn, Field, Shell, icons } from '../ui.jsx';

const TABS = [
  { id: 'today', label: 'Today', icon: icons.today },
  { id: 'visit', label: 'New visit', icon: icons.visit },
];
const VISIT_SCREENS = ['form', 'conflict', 'review', 'syncfail', 'saved', 'novisit'];
const EMPTY = { reason: '', diagnosis: '', treatment: '', vaccine: '', batch: '', next: '' };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Vet clinic app: find a pet, get access, read the record, add a visit. All rules are enforced by the database. */
export default function VetApp({ profile, onSignOut }) {
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
    } catch (e) { setErr(explain(e)); }
  }, [pet, req]);
  useEffect(() => { if (s === 'record') { setData(null); loadRecord(); } }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (isOffline(e)) setS('syncfail');
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
  const shell = (children, extra = {}) => (
    <Shell tabs={TABS} tab={VISIT_SCREENS.includes(s) ? 'visit' : 'today'} onHome={onSignOut} homeLabel="Sign out"
      onTab={(t) => (t === 'today' ? go('today') : canVisit ? startVisit() : go('novisit'))} {...extra}>
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
  if (s === 'today') {
    return shell(
      <>
        <h1>{greeting()}{first ? `, Dr. ${first}` : ''}</h1>
        <p className="meta">{clinic ? `${clinic.name}${clinic.city ? ` · ${clinic.city}` : ''}${clinic.verified ? ' · Verified clinic' : ' · Not yet verified'}` : ' '}</p>
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
        <h2>Open records</h2>
        {recent.length === 0 && <p className="meta">Nothing open yet. Records you have access to appear here.</p>}
        {recent.map((r) => (
          <button key={r.id} className="list-item" onClick={() => openRecent(r)}>
            <span><b>{r.pet_name}</b><br /><span className="meta">{reqState(r) === 'pending' ? `Waiting for owner · asked ${ago(r.created_at)}` : `${scopeLabel(r.scope)} · until ${fmtUntil(r.expires_at)}`}</span></span>
            <span className={`pill ${reqState(r) === 'pending' ? 'warn' : ''}`}>{reqState(r) === 'pending' ? 'Pending' : r.kind === 'emergency' ? 'Emergency' : 'Open'}</span>
          </button>
        ))}
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
        {petHead}
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
            <h1>{data.pet.name}</h1>
            <p className="meta">{petLine(data.pet)}</p>
            <div className="card">
              <b>Alerts</b>
              {data.alerts.length === 0 && <p className="meta">No alerts recorded.</p>}
              {data.alerts.map((a) => <p key={a.id}>{a.kind === 'allergy' ? 'Allergy' : a.kind}: {a.substance}{a.source ? ` (added by ${a.source})` : ''}</p>)}
            </div>
            <div className="card">
              <b>Vaccinations</b>
              {data.vaccs.length === 0 && <p className="meta">No vaccinations recorded.</p>}
              {data.vaccs.map((v) => { const st = vaccStatus(v); return <p key={v.id} className={st.tone === 'warn' ? 'warn-text' : ''}>{v.name} · {st.text}</p>; })}
            </div>
            {full ? (
              <div className="card">
                <b>Visit history · {new Set(data.visits.map((v) => v.clinic_name)).size} clinic{new Set(data.visits.map((v) => v.clinic_name)).size === 1 ? '' : 's'}</b>
                {data.visits.length === 0 && <p className="meta">No visits yet. Yours will be the first.</p>}
                {data.visits.map((v) => (
                  <div key={v.id} className="visit">
                    <p>{fmtDate(v.visit_date)} · {v.clinic_name} · {v.diagnosis}{v.treatment ? ` · ${v.treatment}` : ''}</p>
                    {v.allergy_override_reason && <p className="small">Allergy warning overridden: {v.allergy_override_reason}</p>}
                    {v.lab_missing && (asked[v.id]
                      ? <Banner kind="ok" title={`Request sent to ${v.clinic_name}`}>They’ll add the results when they can.</Banner>
                      : <button className="link-row" onClick={() => askMissing(v.id)} disabled={busy}>⚠ Lab results missing · Request them</button>)}
                  </div>
                ))}
              </div>
            ) : <Banner kind="info" title="Vaccinations only">The owner chose not to share visit history.</Banner>}
            <Btn onClick={startVisit}>Add a visit</Btn>
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
