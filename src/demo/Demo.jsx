import React, { useMemo, useState } from 'react';
import { Paw, Icon, icons, Shell, Banner, Btn, Radio, Demo, Avatar, Person, I } from '../ui.jsx';
import { AlertsCard, PetHero, StatRow, Timeline, VaccCard } from '../live/PetRecord.jsx';
import Profile from '../live/Profile.jsx';
import ChatTab from '../live/Chat.jsx';
import { demoChatApi } from '../lib/chat.js';
import { Hero, PetFeature, PromoCarousel, QuickActions, RequestList, Tiles } from '../live/HomeParts.jsx';
import { AmendBox, AppointmentsCard, AuditCard, DocsCard, HouseholdCard, LostCard, MedsCard, RemindersCard, WeightCard, remindersFor } from '../live/Clinical.jsx';


const PET = 'Labrador Retriever · Male · 6 years · Chip 985 141 000 447 102';
const VET_TABS = [{ id: 'today', label: 'Today', icon: icons.today }, { id: 'visit', label: 'New visit', icon: icons.visit }, { id: 'chat', label: 'Messages', icon: icons.chat }, { id: 'profile', label: 'Profile', icon: icons.profile }];
const OWN_TABS = [{ id: 'home', label: 'Home', icon: icons.home }, { id: 'chat', label: 'Messages', icon: icons.chat }, { id: 'profile', label: 'Profile', icon: icons.profile }];

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const MAX = { id: 'max', name: 'Max', species: 'Dog', breed: 'Labrador Retriever', sex: 'Male', birth_date: iso(-365 * 6 - 30), weight_kg: 31.5, chip: '985141000447102' };
const MAX_ALERTS = [{ id: 'a1', kind: 'allergy', substance: 'Penicillin', source: 'Riga Vet Centre' }];
const MAX_VACCS = [
  { id: 'v1', name: 'Rabies', given_on: iso(-200), valid_until: iso(160), clinic_name: 'Riga Vet Centre' },
  { id: 'v2', name: 'DHPP', given_on: iso(-353), valid_until: iso(12), clinic_name: 'Tartu Lemmikloomakliinik' },
];
const MAX_VISITS = [
  { id: 'x1', visit_date: '2026-09-14', clinic_name: 'Riga Vet Centre', diagnosis: 'Ear infection', treatment: 'Otomax drops', reason: 'Head shaking' },
  { id: 'x2', visit_date: '2026-06-02', clinic_name: 'Tartu Lemmikloomakliinik', diagnosis: 'Vaccination', treatment: 'DHPP booster' },
  { id: 'x3', visit_date: '2026-01-11', clinic_name: 'Riga Vet Centre', diagnosis: 'Bloodwork', lab_missing: true },
];
const MAX_MEDS = [{ id: 'm1', name: 'Meloxicam', dose: '1.5 ml', frequency: 'once a day', end_on: iso(4), prescribed_by: 'Riga Vet Centre' }];
const MAX_WEIGHTS = [{ measured_on: iso(-180), weight_kg: 29.8 }, { measured_on: iso(-90), weight_kg: 30.6 }, { measured_on: iso(-7), weight_kg: 31.5 }];
const MAX_DOCS = [{ id: 'd1', title: 'Blood panel Jan 2026', kind: 'lab', created_at: iso(-300), uploaded_by: 'Riga Vet Centre', path: 'demo' }];
const MAX_LOG = [
  { id: 'l1', actor_name: 'Dr. Tomas Kazlauskas', clinic_name: 'Vilnius Animal Clinic', action: 'view_record', created_at: new Date(Date.now() - 12 * 6e4).toISOString() },
  { id: 'l2', actor_name: 'Dr. Ilze Ozola', clinic_name: 'Riga Vet Centre', action: 'add_visit', detail: 'Ear infection', created_at: new Date(Date.now() - 40 * 864e5).toISOString() },
];
const MAX_APPTS = [{ id: 'p1', status: 'booked', starts_at: new Date(Date.now() + 26 * 36e5).toISOString(), reason: 'Rabies booster' }];
const noop = async () => {};
const VET_ME = { id: 'demo-vet', role: 'vet', full_name: 'Dr. Tomas Kazlauskas', email: 'tomas.kazlauskas@pawfile.itsallan.me', phone: '+370 612 34 567', created_at: '2026-03-02' };
const OWN_ME = { id: 'demo-owner', role: 'owner', full_name: 'Laura Kalnina', email: 'laura.kalnina@pawfile.itsallan.me', phone: '+371 2000 0000', created_at: '2026-01-15' };

/* ---------- VET APP (Jobs 1 and 2) ---------- */
function VetApp({ onHome }) {
  const [s, setS] = useState('J1-01');
  const vetChat = useMemo(() => demoChatApi('vet'), []);
  const [query, setQuery] = useState('+370 612 34 567');
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState(false);
  const [treat, setTreat] = useState('Amoxicillin 250 mg, twice a day, 7 days');
  const [form, setForm] = useState({ reason: 'Limping, front left leg', diagnosis: '', vaccine: 'DHPP booster', batch: '', next: '26 Oct 2026' });
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(false);
  const [reason, setReason] = useState('Earlier reaction was a mild rash. Owner informed and agrees.');
  const [ack, setAck] = useState(false);
  const [override, setOverride] = useState(false);
  const [syncTries, setSyncTries] = useState(0);
  const [emReason, setEmReason] = useState('Hit by car, owner not answering phone');
  const [emOk, setEmOk] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const tab = s === 'J1-P' ? 'profile' : s === 'J1-C' ? 'chat' : ['J2-01', 'J2-02', 'J2-03', 'J2-06', 'J2-07', 'J2-04', 'J2-05'].includes(s) ? 'visit' : 'today';
  const go = (x) => setS(x);
  const onTab = (t) => (t === 'today' ? go('J1-01') : t === 'profile' ? go('J1-P') : t === 'chat' ? go('J1-C') : go('J2-01'));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const search = () => {
    const q = query.toLowerCase().replace(/\s/g, '');
    go(q.includes('max') || q.includes('985') || q.includes('447') ? 'J1-03' : 'J1-02');
  };
  const validate = () => {
    const e = {};
    if (!form.diagnosis.trim()) e.diagnosis = 'Diagnosis is required';
    if (form.vaccine.trim() && !form.batch.trim()) e.batch = 'Batch number is required when a vaccine is given';
    return e;
  };
  const trySave = () => {
    const e = validate();
    setErrors(e);
    const c = /amoxicillin/i.test(treat);
    setConflict(c);
    go(Object.keys(e).length || c ? 'J2-02' : 'J2-03');
  };
  const fillAfterChoice = () => setForm((f) => ({ ...f, diagnosis: f.diagnosis.trim() || 'Carpal sprain, front left', batch: f.batch.trim() || 'DH-2291' }));
  const switchMelox = () => { setTreat('Meloxicam 1.5 mg/ml, 7 days'); setOverride(false); setConflict(false); fillAfterChoice(); setErrors({}); go('J2-03'); };
  const confirmShare = () => { const n = syncTries + 1; setSyncTries(n); go(n === 1 ? 'J2-04' : 'J2-05'); };
  const retry = () => { setSyncTries(syncTries + 1); go('J2-05'); };
  const unlockWithCode = () => {
    if (code.replace(/\s/g, '') === '482913') { setUnlocked(true); setCodeErr(false); go('J1-06'); } else setCodeErr(true);
  };

  const shell = (children, extra = {}) => (
    <Shell tabs={VET_TABS} tab={tab} onTab={onTab} onHome={onHome} {...extra}>{children}</Shell>
  );

  switch (s) {
    case 'J1-01':
      return shell(<>
        <Hero title="Good morning, Dr. Kazlauskas" line="Vilnius Animal Clinic · 8 appointments today" profile={VET_ME} onProfile={() => go('J1-P')} />
        <QuickActions items={[
          { label: 'Find pet', icon: 'user', onClick: () => document.getElementById('q')?.focus() },
          { label: 'New visit', icon: 'clipboard', onClick: () => go('J2-01') },
          { label: 'Emergency', icon: 'alert', onClick: () => go('J1-05') },
          { label: 'Profile', icon: 'id', onClick: () => go('J1-P') },
        ]} />
        <div className="card">
          <h2>Find a pet</h2>
          <div className="field">
            <label htmlFor="q">Microchip number or owner phone</label>
            <input id="q" value={query} onChange={(e) => setQuery(e.target.value)} inputMode="search" />
          </div>
          <Btn onClick={search}>Search</Btn>
          <Btn kind="secondary" onClick={() => go('J1-03')}>Scan microchip</Btn>
          <p className="small">Tip: the demo pet is Max. Try “Max” or chip 985 141 000 447 102.</p>
        </div>
        <Tiles title="Your day" items={[
          { label: 'Appointments', value: '8', sub: '3 left today', tone: 'g' },
          { label: 'Waiting', value: '1', sub: 'for owner approval', tone: 'o' },
          { label: 'Licence', value: 'Verified', sub: 'can add visits', tone: 'b' },
          { label: 'Clinic', value: 'Verified', sub: 'Vilnius Animal Clinic', tone: 'p' },
        ]} />
        <RequestList title="Today" icon="clipboard" onOpen={() => go('J1-03')} items={[
          { id: 'a', title: 'Max · Dog · New patient', sub: '10:30 · Visiting from Latvia', cta: 'Open' },
          { id: 'b', title: 'Bella · Cat · Follow-up', sub: '11:00', cta: 'Open' },
          { id: 'c', title: 'Rex · Dog · Vaccination', sub: '11:30', cta: 'Open' },
        ]} />
      </>);
    case 'J1-02':
      return shell(<>
        <h1>Find a pet</h1>
        <Banner kind="warn" title={`No pet found for ${query}`}>This phone number isn’t linked to any pet in PawFile. The pet may be registered under another owner’s number or in another country.</Banner>
        <Btn onClick={() => go('J1-03')}>Scan microchip instead</Btn>
        <Btn kind="secondary" onClick={() => go('J1-01')}>Edit search</Btn>
      </>);
    case 'J1-03':
      return shell(<>
        <h1>Max</h1>
        <p className="meta">{PET}</p>
        <div className="card"><span className="small">Registered at</span><p><b>Riga Vet Centre · Latvia</b></p><p className="small">Owner: Laura K. · +371 •••• 4410</p></div>
        <Banner kind="warn" title="You can’t see Max’s health history yet">The owner hasn’t shared this record with Vilnius Animal Clinic. Ask the owner, or use emergency access if the pet needs urgent care.</Banner>
        <Btn onClick={() => go('J1-04')}>Request access from owner</Btn>
        <Btn kind="secondary" onClick={() => go('J1-05')}>Emergency access</Btn>
        <Btn kind="ghost" onClick={() => go('J1-01')}>Back</Btn>
      </>);
    case 'J1-04':
      return shell(<>
        <h1>Access requested</h1>
        <p className="meta">{PET}</p>
        <Banner kind="info" title="Request sent to Laura K.">She got an app notification and an SMS. The request expires in 30 minutes.</Banner>
        <div className="card">
          <div className="field">
            <label htmlFor="c">Or enter the owner’s one-time code</label>
            <input id="c" value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(false); }} placeholder="6-digit code from the owner’s app" inputMode="numeric" maxLength={7} />
            {codeErr && <div className="err-text">That code didn’t work. Check the 6 digits (demo code: 482 913).</div>}
          </div>
          <Btn onClick={unlockWithCode} disabled={code.replace(/\s/g, '').length < 6}>Unlock with code</Btn>
        </div>
        <Demo who="the owner">
          <Btn kind="outline" onClick={() => { setUnlocked(true); go('J1-06'); }}>Owner approved</Btn>
          <Btn kind="outline" onClick={() => go('J1-03')}>Owner can’t be reached</Btn>
        </Demo>
        <Btn kind="ghost" onClick={() => go('J1-03')}>Cancel request</Btn>
      </>);
    case 'J1-05':
      return shell(<>
        <h1>Emergency access</h1>
        <p className="meta">{PET}</p>
        <Banner kind="err" title="Every emergency access is logged">Use only if the pet needs urgent care and the owner can’t be reached. Laura K. and Riga Vet Centre are notified straight away. Access ends after 4 hours.</Banner>
        <div className="field"><label htmlFor="r">Reason (required)</label><textarea id="r" rows={3} value={emReason} onChange={(e) => setEmReason(e.target.value)} /></div>
        <label className="row" style={{ marginBottom: 14, fontSize: 15 }}><input type="checkbox" checked={emOk} onChange={(e) => setEmOk(e.target.checked)} style={{ width: 20, height: 20 }} /> I confirm this is a medical emergency</label>
        <Btn kind="danger" disabled={!emOk || !emReason.trim()} onClick={() => { setUnlocked('emergency'); go('J1-06'); }}>Open record for 4 hours</Btn>
        <Btn kind="secondary" onClick={() => go('J1-03')}>Go back</Btn>
      </>);
    case 'J1-06':
      return shell(<>
        {unlocked === 'emergency'
          ? <Banner kind="err" title="Emergency access for 4 hours">Logged with your reason. Laura K. and Riga Vet Centre have been notified.</Banner>
          : <Banner kind="ok" title="Access granted until today 23:59">Laura K. approved your request. She can revoke access at any time.</Banner>}
        <PetHero pet={MAX} badges={[<span key="s" className="chip">Full history</span>, <span key="a" className="chip danger">1 alert</span>]} />
        <StatRow pet={MAX} />
        <AlertsCard alerts={MAX_ALERTS} />
        <VaccCard vaccs={MAX_VACCS} />
        <Timeline visits={MAX_VISITS} />
        <Banner kind="warn" title="Missing data">Lab results for 11 Jan 2026 were never uploaded by Riga Vet Centre.</Banner>
        <Btn kind="outline" onClick={() => go('J1-07')}>Request missing results</Btn>
        <Btn onClick={() => go('J2-01')}>Start new visit note</Btn>
        <Btn kind="ghost" onClick={() => go('J1-01')}>Back to today</Btn>
      </>);
    case 'J1-C':
      return shell(<ChatTab role="vet" api={vetChat} />);
    case 'J1-P':
      return shell(<Profile demo profile={VET_ME} clinic={{ name: 'Vilnius Animal Clinic', city: 'Vilnius', verified: true }} activity={[{ id: '1', title: 'Max', sub: '2 min ago', pill: 'active' }, { id: '2', title: 'Luna', sub: 'Yesterday', pill: 'expired', warn: true }]} onSignOut={onHome} />);
    case 'J1-07':
      return shell(<>
        <h1>Max</h1>
        <p className="meta">{PET}</p>
        <Banner kind="ok" title="Request sent to Riga Vet Centre">You’ll get a notification when the lab results are added to Max’s record. Clinics usually reply within 1 working day.</Banner>
        <Btn onClick={() => go('J1-06')}>Back to Max’s record</Btn>
      </>);
    case 'J2-01':
      return shell(<>
        <h1>New visit note</h1>
        <p className="meta">Max · Labrador Retriever · 6 years · <b style={{ color: 'var(--red)' }}>Allergy: Penicillin</b></p>
        <Banner kind="info" title="Shared note">This note is saved to Max’s shared record. Every clinic the owner shares with will see it.</Banner>
        <div className="field"><label htmlFor="f1">Reason for visit</label><input id="f1" value={form.reason} onChange={set('reason')} /></div>
        <div className="field"><label htmlFor="f2">Diagnosis</label><input id="f2" value={form.diagnosis} onChange={set('diagnosis')} placeholder="Search diagnosis, e.g. “sprain”" /></div>
        <div className="field"><label htmlFor="f3">Treatment / medication</label><input id="f3" value={treat} onChange={(e) => setTreat(e.target.value)} /></div>
        <div className="field"><label htmlFor="f4">Vaccine given (optional)</label><input id="f4" value={form.vaccine} onChange={set('vaccine')} /></div>
        <div className="field"><label htmlFor="f5">Vaccine batch number</label><input id="f5" value={form.batch} onChange={set('batch')} placeholder="e.g. DH-2291" /></div>
        <div className="field"><label htmlFor="f6">Next check-up</label><input id="f6" value={form.next} onChange={set('next')} /></div>
        <Btn onClick={trySave}>Save to shared record</Btn>
        <Btn kind="ghost" onClick={() => go('J1-06')}>Cancel</Btn>
      </>);
    case 'J2-02': {
      const n = Object.keys(errors).length + (conflict ? 1 : 0);
      return shell(<>
        <h1>{n} thing{n === 1 ? '' : 's'} to fix before saving</h1>
        <p className="meta">Nothing has been shared yet. Your entries are kept.</p>
        <p className="meta">Max · Labrador Retriever · 6 years · <b style={{ color: 'var(--red)' }}>Allergy: Penicillin</b></p>
        <div className={`field ${errors.diagnosis ? 'bad' : ''}`}><label htmlFor="g1">Diagnosis</label><input id="g1" value={form.diagnosis} onChange={set('diagnosis')} placeholder="Search diagnosis, e.g. “sprain”" />{errors.diagnosis && <div className="err-text">! {errors.diagnosis}</div>}</div>
        <div className={`field ${errors.batch ? 'bad' : ''}`}><label htmlFor="g2">Vaccine batch number</label><input id="g2" value={form.batch} onChange={set('batch')} placeholder="e.g. DH-2291" />{errors.batch && <div className="err-text">! {errors.batch}</div>}</div>
        <Btn onClick={() => { const e = validate(); setErrors(e); if (!Object.keys(e).length && !conflict) go('J2-03'); }}>Check again</Btn>
        <Btn kind="ghost" onClick={() => go('J2-01')}>Back to the form</Btn>
      </>, {
        overlay: conflict && (
          <div className="overlay"><div className="sheet" role="alertdialog" aria-labelledby="ac">
            <h2 id="ac">Allergy conflict: Max is allergic to Penicillin</h2>
            <p className="meta">You prescribed Amoxicillin 250 mg. Amoxicillin is a penicillin-type antibiotic. You must decide before saving. Choose what to do:</p>
            <Btn onClick={switchMelox}>Switch to Meloxicam 1.5 mg/ml</Btn>
            <Btn kind="secondary" onClick={() => { fillAfterChoice(); setErrors({}); go('J2-06'); }}>Keep Amoxicillin and give a reason</Btn>
          </div></div>
        ),
      });
    }
    case 'J2-06':
      return shell(<>
        <h1>Keep Amoxicillin?</h1>
        <p className="meta">Max · Labrador Retriever · 6 years · <b style={{ color: 'var(--red)' }}>Allergy: Penicillin</b></p>
        <Banner kind="err" title="You’re overriding an allergy warning">Your reason is saved with this visit. Laura K. and every clinic that can see Max’s record will see it.</Banner>
        <div className="field"><label htmlFor="or">Reason (required)</label><textarea id="or" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <label className="row" style={{ marginBottom: 14, fontSize: 15 }}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20 }} /> I take clinical responsibility for this decision</label>
        <Btn disabled={!ack || !reason.trim()} onClick={() => { setOverride(true); go('J2-07'); }}>Continue to review</Btn>
        <Btn kind="secondary" onClick={switchMelox}>Switch to Meloxicam instead</Btn>
      </>);
    case 'J2-03':
    case 'J2-07': {
      const ov = s === 'J2-07' && override;
      return shell(<>
        <h1>Check before sharing</h1>
        <p className="meta">Max · Labrador Retriever · 6 years · <b style={{ color: 'var(--red)' }}>Allergy: Penicillin</b></p>
        <div className="card">
          <p><b>Visit 12 Oct 2026 · Vilnius Animal Clinic</b></p>
          <p>Reason: {form.reason}</p><p>Diagnosis: {form.diagnosis || 'Carpal sprain, front left'}</p><p>Treatment: {treat}</p>
          <p>Vaccine: {form.vaccine} · batch {form.batch || 'DH-2291'}</p><p>Next check-up: {form.next}</p>
        </div>
        {ov && <Banner kind="err" title="Allergy override will be shown on this visit">Reason: {reason}</Banner>}
        <div className="card"><h2>Who will see this</h2><p>Laura K. (owner), she gets a notification</p><p>Riga Vet Centre (home clinic)</p><p>Any clinic Laura shares Max’s record with later</p></div>
        <Btn onClick={confirmShare}>Confirm and share</Btn>
        <Btn kind="secondary" onClick={() => go('J2-01')}>Edit</Btn>
      </>);
    }
    case 'J2-04':
      return shell(<>
        <h1>Couldn’t reach PawFile</h1>
        <Banner kind="warn" title="You’re offline">Your internet connection dropped. The visit is saved on this device and will be shared automatically when you’re back online. Nothing is lost.</Banner>
        <div className="card"><span className="pill warn">Waiting to sync (1)</span><p>Max · visit 12 Oct 2026 · saved 10:52</p></div>
        <Btn onClick={retry}>Try again now</Btn>
        <Btn kind="ghost" onClick={() => go('J1-01')}>Back to today</Btn>
      </>);
    case 'J2-05':
      return shell(<>
        <div className="big-check">✓</div>
        <h1>Visit saved to Max’s shared record</h1>
        <p className="meta">Synced at 10:53 · Laura K. has been notified.</p>
        <div className="card"><h2>What changed</h2><p>DHPP: now valid until Oct 2027</p><p>New medication added to Max’s record, ends 19 Oct 2026</p><p>Check-up reminder set for 26 Oct 2026</p></div>
        <Btn onClick={() => go('J1-01')}>Back to today</Btn>
        <Btn kind="secondary" onClick={() => go('J1-06')}>View Max’s record</Btn>
      </>);
    default:
      return null;
  }
}

/* ---------- OWNER APP (Job 3) ---------- */
const SCOPES = ['Full health history', 'Vaccinations only'];
const DURS = ['Today only (until 23:59)', '30 days', 'Until I stop it'];

function OwnerApp({ onHome }) {
  const [s, setS] = useState('J3-01');
  const ownChat = useMemo(() => demoChatApi('owner'), []);
  const [scope, setScope] = useState(SCOPES[0]);
  const [dur, setDur] = useState(DURS[0]);
  const [pending, setPending] = useState(['vilnius', 'kaunas']);
  const [vilnius, setVilnius] = useState(null);
  const [kaunasCode, setKaunasCode] = useState(false);
  const [pin, setPin] = useState('');
  const go = (x) => setS(x);
  const tab = s === 'J3-P' ? 'profile' : s === 'J3-C' ? 'chat' : 'home';
  const onTab = (t) => go(t === 'home' ? 'J3-01' : t === 'profile' ? 'J3-P' : 'J3-C');
  const closeReq = (id) => setPending((p) => p.filter((x) => x !== id));
  const clinics = 1 + (vilnius ? 1 : 0) + (kaunasCode ? 1 : 0);
  const shell = (children, back) => (
    <Shell tabs={OWN_TABS} tab={tab} onTab={onTab} onHome={onHome} onBack={back ? () => go(back) : undefined}>{children}</Shell>
  );

  switch (s) {
    case 'J3-01':
      return shell(<>
        <Hero title="Good morning, Laura" line={pending.length ? `${pending.length} clinic${pending.length > 1 ? 's are' : ' is'} waiting for your answer` : 'All of Max’s records are up to date.'} profile={OWN_ME} onProfile={() => go('J3-P')} pet={MAX} />
        <QuickActions items={[
          { label: 'Add pet', icon: 'user', onClick: noop },
          { label: 'Share', icon: 'key', onClick: () => go('J3-09') },
          { label: 'Sharing', icon: 'lock', onClick: () => go('J3-07') },
          { label: 'Profile', icon: 'id', onClick: () => go('J3-P') },
        ]} />
        <RequestList onOpen={(r) => go(r.id === 'vilnius' ? 'J3-03' : 'J3-02')} items={[
          ...(pending.includes('vilnius') ? [{ id: 'vilnius', title: 'Vilnius Animal Clinic wants to see Max’s history', sub: '2 minutes ago' }] : []),
          ...(pending.includes('kaunas') ? [{ id: 'kaunas', title: 'Kaunas Pet Hospital wants to see Max’s history', sub: 'Yesterday' }] : []),
        ]} />
        <PetFeature pet={MAX} onOpen={() => go('J3-14')} badge={`Shared with ${clinics} clinic${clinics > 1 ? 's' : ''}`}
          stats={[{ v: '6 years', l: 'Age' }, { v: '31.5 kg', l: 'Weight' }, { v: '…102', l: 'Chip' }]} />
        <Tiles items={[
          { label: 'Weight', value: '31.5 kg', sub: '+0.9 kg since June', tone: 'g' },
          { label: 'Next vaccine', value: '2 May', sub: 'Rabies · 2027', tone: 'b' },
          { label: 'Medication', value: '1 active', sub: 'Meloxicam, 4 days left', tone: 'o' },
          { label: 'Last visit', value: '14 Sep', sub: 'Ear infection', tone: 'p' },
        ]} />
        <PromoCarousel />
      </>);
    case 'J3-14':
      return shell(<>
        <PetHero pet={MAX} onPhoto={() => {}} badges={[<span key="s" className="chip">Shared with {clinics} clinic{clinics > 1 ? 's' : ''}</span>, <span key="a" className="chip danger">1 alert</span>]} />
        <StatRow pet={MAX} />
        <RemindersCard items={remindersFor(MAX_VACCS, MAX_MEDS, MAX_APPTS)} />
        <AlertsCard alerts={MAX_ALERTS} />
        <VaccCard vaccs={MAX_VACCS} />
        <MedsCard meds={MAX_MEDS} canEdit onAdd={noop} />
        <WeightCard logs={MAX_WEIGHTS} canEdit onAdd={noop} />
        <DocsCard docs={MAX_DOCS} canEdit onOpen={noop} onUpload={noop} />
        <AppointmentsCard appts={MAX_APPTS} who="owner" onStatus={noop} />
        <AuditCard log={MAX_LOG} title="Who has opened this record" />
        <Timeline visits={MAX_VISITS} extra={(v) => <AmendBox visit={v} amendments={v.id === 'x1' ? [{ id: 'z', visit_id: 'x1', amended_name: 'Dr. Ilze Ozola', created_at: new Date(Date.now() - 864e5).toISOString(), reason: 'Wrong ear recorded', old_values: { diagnosis: 'Ear infection, right' } }] : []} />} />
        <HouseholdCard pet={MAX} onAdd={async () => 'ok'} onTransfer={async () => 'ok'} />
        <LostCard pet={MAX} onToggle={noop} />
        <Btn onClick={() => go('J3-09')}>Share with a code</Btn>
      </>, 'J3-01');
    case 'J3-C':
      return shell(<ChatTab role="owner" api={ownChat} />);
    case 'J3-P':
      return shell(<Profile demo profile={OWN_ME} activity={[{ id: '1', title: 'Vilnius Animal Clinic · Max', sub: '2 min ago', pill: 'pending', warn: true }, { id: '2', title: 'Riga Vet Centre · Max', sub: '14 Sep', pill: 'active' }]} onSignOut={onHome} />);
    case 'J3-02':
      return shell(<>
        <Banner kind="warn" title="This request has expired">Kaunas Pet Hospital asked yesterday. For safety, requests expire after 30 minutes.</Banner>
        <p className="meta">If you are at the clinic now, show them a one-time code instead.</p>
        <Btn onClick={() => go('J3-09')}>Share with a code instead</Btn>
        <Btn kind="secondary" onClick={() => go('J3-01')}>Back to Max</Btn>
      </>, 'J3-01');
    case 'J3-03':
      return shell(<>
        <h1>Vilnius Animal Clinic wants to see Max’s record</h1>
        <p className="meta">Dr. R. Kazlauskas · Verified clinic · Vilnius, Lithuania</p>
        <span className="label">What can they see?</span>
        <div role="radiogroup">{SCOPES.map((x) => <Radio key={x} on={scope === x} onClick={() => setScope(x)}>{x}</Radio>)}</div>
        <span className="label">For how long?</span>
        <div role="radiogroup">{DURS.map((x) => <Radio key={x} on={dur === x} onClick={() => setDur(x)}>{x}</Radio>)}</div>
        <span className="label">You’re about to share</span>
        <div className="chips"><span className="chip">{scope}</span><span className="chip">{dur}</span></div>
        <div className="btns"><Btn onClick={() => go('J3-04')}>Approve</Btn><Btn kind="secondary" onClick={() => { closeReq('vilnius'); go('J3-11'); }}>Decline</Btn></div>
        <Btn kind="ghost" onClick={() => go('J3-12')}>I don’t know this clinic</Btn>
      </>, 'J3-01');
    case 'J3-04':
      return shell(<>
        <div className="faceid" aria-hidden="true"><I n="lock" size={64} /></div>
        <h1>Face ID didn’t recognise you</h1>
        <p className="meta">We need to confirm it’s you before sharing health records.</p>
        <Btn onClick={() => { setPin(''); go('J3-05'); }}>Use PIN instead</Btn>
        <Btn kind="secondary" onClick={() => go('J3-03')}>Cancel</Btn>
      </>, 'J3-03');
    case 'J3-05':
      return shell(<>
        <h1>Enter your PawFile PIN</h1>
        <div className="field"><label htmlFor="pin">4-digit PIN</label><input id="pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="• • • •" /></div>
        <p className="small">Prototype: any 4 digits work.</p>
        <Btn disabled={pin.length !== 4} onClick={() => { setVilnius({ scope, dur }); closeReq('vilnius'); go('J3-06'); }}>Confirm</Btn>
      </>, 'J3-04');
    case 'J3-06':
      return shell(<>
        <Banner kind="ok" title="Access approved">Vilnius Animal Clinic can now see Max’s record. We’ll tell you when they add a visit.</Banner>
        <span className="label">What they can see</span><div className="card">{vilnius?.scope || scope}</div>
        <span className="label">For how long</span><div className="card">{vilnius?.dur || dur}</div>
        <Btn onClick={() => go('J3-01')}>Done</Btn>
        <Btn kind="secondary" onClick={() => go('J3-07')}>Manage who has access</Btn>
      </>);
    case 'J3-07':
      return shell(<>
        <h1>Who has access</h1>
        <p className="meta">Everyone who can open Max’s record, what they can see and for how long.</p>
        <div className="group">
          <div className="acc-row"><Person profile={{ full_name: 'Dr. Ilze Ozola' }} size={42} /><span className="row-main"><b>Dr. Ilze Ozola</b><small>Veterinarian · Riga Vet Centre, Latvia</small><small>Home clinic · Full history · No end date</small></span><span className="pill">Active</span></div>
          {vilnius && <div className="acc-row"><Person profile={{ full_name: 'Dr. Tomas Kazlauskas' }} size={42} /><span className="row-main"><b>Dr. Tomas Kazlauskas</b><small>Veterinarian · Vilnius Animal Clinic, Lithuania</small><small>{vilnius.scope} · {vilnius.dur}</small><button className="link-row quiet" onClick={() => go('J3-08')}>Stop sharing</button></span><span className="pill">Active</span></div>}
          {kaunasCode && <div className="acc-row"><Person profile={{ full_name: 'Dr. Jonas Petrauskas' }} size={42} /><span className="row-main"><b>Dr. Jonas Petrauskas</b><small>Veterinarian · Kaunas Pet Hospital, Lithuania</small><small>Full health history · Today only (until 23:59)</small><button className="link-row quiet" onClick={() => setKaunasCode(false)}>Stop sharing</button></span><span className="pill">Active</span></div>}
          <div className="acc-row off"><Person profile={{ full_name: 'Tartu Lemmikloomakliinik' }} size={42} /><span className="row-main"><b>Tartu Lemmikloomakliinik</b><small>Clinic · Estonia</small><small>Access ended 02 Jun 2026</small></span><span className="pill">Ended</span></div>
        </div>
      </>, 'J3-01');
    case 'J3-08':
      return shell(<>
        <h1>Stop Vilnius Animal Clinic seeing Max’s record?</h1>
        <p className="meta">They won’t see Max’s record anymore. Visits they already added stay in the record.</p>
        <Btn kind="danger" onClick={() => { setVilnius(null); go('J3-10'); }}>Stop sharing</Btn>
        <Btn kind="secondary" onClick={() => go('J3-07')}>Keep access</Btn>
      </>, 'J3-07');
    case 'J3-09':
      return shell(<>
        <h1>Share Max’s record</h1>
        <p className="meta">Show this code at the clinic desk. It works once.</p>
        <div className="qr" role="img" aria-label="QR code (placeholder)" />
        <div className="code">482 913</div>
        <p className="meta" style={{ textAlign: 'center' }}>Valid for 10 minutes · Shares full history, today only</p>
        <Demo who="the clinic"><Btn kind="outline" onClick={() => { setKaunasCode(true); closeReq('kaunas'); go('J3-13'); }}>Clinic entered the code</Btn></Demo>
        <Btn kind="secondary" onClick={() => go('J3-01')}>Cancel</Btn>
      </>, 'J3-01');
    case 'J3-10':
      return shell(<>
        <Banner kind="ok" title="Access revoked">Vilnius Animal Clinic can no longer see Max’s record. They have been notified.</Banner>
        <Btn onClick={() => go('J3-01')}>Back to Max</Btn>
      </>);
    case 'J3-11':
      return shell(<>
        <Banner kind="info" title="Request declined">Vilnius Animal Clinic can’t see Max’s record. We’ve told them you said no.</Banner>
        <p className="meta">Changed your mind? You can still share with a one-time code at the clinic desk.</p>
        <Btn onClick={() => go('J3-01')}>Back to Max</Btn>
        <Btn kind="secondary" onClick={() => go('J3-09')}>Share with a code</Btn>
      </>);
    case 'J3-12':
      return shell(<>
        <Banner kind="ok" title="Thanks. This request is blocked">Vilnius Animal Clinic can’t see Max’s record. The PawFile team will check this clinic within 24 hours and email you.</Banner>
        <Btn onClick={() => { closeReq('vilnius'); go('J3-01'); }}>Back to Max</Btn>
      </>);
    case 'J3-13':
      return shell(<>
        <Banner kind="ok" title="Code accepted">Kaunas Pet Hospital used your code. They can see Max’s full history until today 23:59. We’ll tell you when they add a visit.</Banner>
        <Btn onClick={() => go('J3-01')}>Back to Max</Btn>
      </>);
    default:
      return null;
  }
}

/* ---------- ROOT ---------- */
export default function DemoApp({ onExit }) {
  const [app, setApp] = useState(null);
  const [key, setKey] = useState(0);
  const pick = (a) => { setKey((k) => k + 1); setApp(a); };
  return (
    <div className="stage">
      <div className="phone">
        {app === null && (
          <div className="landing">
            <div className="row between"><div className="logo"><Paw /> PawFile</div>{onExit && <button className="home-link" onClick={onExit}>‹ Back to sign in</button>}</div>
            <h1>One health record for every pet, in every clinic.</h1>
            <p className="meta">Clickable prototype. Pick who you are to start. Sample data only (Max the Labrador): nothing here is real and nothing is saved.</p>
            <button className="role" onClick={() => pick('vet')}>
              <span className="tag">Vet clinic app</span>
              <strong>I’m a vet at Vilnius Animal Clinic</strong>
              <span>Look up Max, who was treated in Latvia, and add today’s visit to his shared record.</span>
            </button>
            <button className="role" onClick={() => pick('owner')}>
              <span className="tag">Pet owner app</span>
              <strong>I’m Max’s owner</strong>
              <span>A clinic wants to see Max’s record. Decide what they see, for how long, and stop sharing later.</span>
            </button>
            <p className="note">Some things are forced on purpose so you meet every state: the first search finds nothing, the first save fails offline, and Face ID always fails. Boxes marked “Demo control” stand in for the other person (the owner or the clinic).</p>
          </div>
        )}
        {app === 'vet' && <VetApp key={key} onHome={() => setApp(null)} />}
        {app === 'owner' && <OwnerApp key={key} onHome={() => setApp(null)} />}
      </div>
    </div>
  );
}
