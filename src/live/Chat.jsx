import React, { useEffect, useRef, useState } from 'react';
import { explain } from '../lib/supabase.js';
import { Banner, I, Person } from '../ui.jsx';

const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => {
  const d = new Date(ts); const n = new Date(); const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const short = (ts) => {
  const d = new Date(ts); const n = new Date();
  return d.toDateString() === n.toDateString() ? clock(ts) : dayLabel(ts);
};

function Thread({ thread, role, api, onBack }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const other = role === 'owner' ? thread.vet_name : thread.owner_name;
  const sub = role === 'owner' ? `${thread.clinic_name || 'Clinic'} · about ${thread.pet_name}` : `Owner of ${thread.pet_name}`;

  const load = async () => {
    try { setMsgs(await api.listMessages(thread.id)); api.markRead(thread.id).catch(() => {}); } catch (e) { setErr(explain(e)); setMsgs([]); }
  };
  useEffect(() => { load(); return api.subscribe(load); }, [thread.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(''); setText('');
    try { await api.send(thread.id, body); await load(); } catch (e) { setErr(explain(e)); setText(body); }
    setBusy(false);
  };

  let last = '';
  return (
    <div className="chat">
      <div className="chat-head">
        <button className="chat-back" onClick={onBack} aria-label="Back to messages">‹</button>
        <Person profile={{ full_name: other }} size={40} />
        <span className="row-main"><b>{other || 'Conversation'}</b><small>{sub}</small></span>
      </div>
      {err && <Banner kind="err" title="That didn’t work">{err}</Banner>}
      <div className="msgs" aria-live="polite">
        {msgs === null && <p className="meta">Loading…</p>}
        {msgs?.length === 0 && <p className="meta chat-empty">No messages yet. Say hello.</p>}
        {msgs?.map((m) => {
          const d = dayLabel(m.created_at);
          const head = d !== last ? <div className="chat-day" key={`d${m.id}`}>{d}</div> : null;
          last = d;
          const mine = m.sender_id === api.me;
          return (
            <React.Fragment key={m.id}>
              {head}
              <div className={`msg ${mine ? 'me' : 'them'}`}><p>{m.body}</p><span>{clock(m.created_at)}</span></div>
            </React.Fragment>
          );
        })}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" maxLength={2000} aria-label="Message" />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send"><I n="send" size={18} /></button>
      </form>
    </div>
  );
}

export default function ChatTab({ role, api }) {
  const [threads, setThreads] = useState(null);
  const [open, setOpen] = useState(null);
  const [picking, setPicking] = useState(false);
  const [options, setOptions] = useState([]);
  const [err, setErr] = useState('');

  const reload = async () => {
    try { setThreads(await api.listThreads()); } catch (e) { setErr(explain(e)); setThreads([]); }
  };
  useEffect(() => { reload(); return api.subscribe(reload); }, []);

  const startPick = async () => {
    setErr('');
    try { setOptions(await api.startables()); setPicking(true); } catch (e) { setErr(explain(e)); }
  };
  const begin = async (o) => {
    try {
      const id = await api.start(o);
      const all = await api.listThreads(); setThreads(all);
      setOpen(all.find((t) => t.id === id) || null); setPicking(false);
    } catch (e) { setErr(explain(e)); }
  };

  if (open) return <Thread thread={open} role={role} api={api} onBack={() => { setOpen(null); reload(); }} />;

  return (
    <>
      <div className="sec-head" style={{ marginTop: 4 }}>
        <h1 style={{ margin: 0 }}>Messages</h1>
        <button className="mini" onClick={startPick}>New</button>
      </div>
      <p className="meta">{role === 'owner' ? 'Chat with the vets and nurses who look after your pets.' : 'Chat with the owners of the pets you treat.'}</p>
      {err && <Banner kind="err" title="That didn’t work">{err}</Banner>}
      {picking && (
        <div className="group" style={{ marginBottom: 16 }}>
          {options.length === 0 && <p className="meta" style={{ padding: 14, margin: 0 }}>{role === 'owner' ? 'No vet has access to your pets yet. Once a clinic is approved you can message them here.' : 'Open a pet’s record first, then you can message the owner.'}</p>}
          {options.map((o) => (
            <button key={o.key} className="grow-row" onClick={() => begin(o)}>
              <Person profile={{ full_name: o.label }} size={40} />
              <span className="row-main"><b>{o.label}</b><small>{o.sub}</small></span>
              <span className="row-go">Start ›</span>
            </button>
          ))}
        </div>
      )}
      {threads === null && <p className="meta">Loading…</p>}
      {threads?.length === 0 && !picking && (
        <div className="card chat-empty-card"><I n="chat" size={28} /><b>No conversations yet</b><p className="small">Tap New to message {role === 'owner' ? 'a vet' : 'an owner'}.</p></div>
      )}
      {threads?.length > 0 && (
        <div className="group">
          {threads.map((t) => {
            const other = role === 'owner' ? t.vet_name : t.owner_name;
            return (
              <button key={t.id} className="grow-row" onClick={() => setOpen(t)}>
                <Person profile={{ full_name: other }} size={46} />
                <span className="row-main">
                  <b>{other || 'Conversation'}</b>
                  <small>{role === 'owner' ? `${t.clinic_name || 'Clinic'} · ${t.pet_name}` : `Owner of ${t.pet_name}`}</small>
                  <small className={t.unread ? 'unread-line' : ''}>{t.last_body || 'No messages yet'}</small>
                </span>
                <span className="chat-meta"><small>{short(t.last_at)}</small>{t.unread > 0 && <i className="dot-n">{t.unread}</i>}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
