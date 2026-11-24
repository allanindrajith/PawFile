import { useEffect, useState } from 'react';
import { rpc, isOffline } from './supabase.js';

/* A tiny outbox for visit notes. If a save fails because the clinic is offline, the call is kept in this
   browser (localStorage) and retried when the connection returns, so a note typed in a bad-signal room
   is not lost. It only queues add_visit; everything else still shows an error. */

const KEY = 'pawfile.outbox.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (q) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } window.dispatchEvent(new Event('pf-outbox')); };

export const queueVisit = (args, label) => write([...read(), { id: crypto.randomUUID(), fn: 'add_visit', args, label, at: Date.now() }]);
export const outboxCount = () => read().length;

let flushing = false;
/** Try to send queued items. Stops at the first offline error; drops items the server rejects for good. */
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return { sent: 0, dropped: [] };
  flushing = true;
  let sent = 0;
  const dropped = [];
  try {
    for (const item of read()) {
      try {
        await rpc(item.fn, item.args);
        sent += 1;
        write(read().filter((x) => x.id !== item.id));
      } catch (e) {
        if (isOffline(e)) break;
        dropped.push({ label: item.label, reason: String(e?.message || e) });
        write(read().filter((x) => x.id !== item.id));
      }
    }
  } finally { flushing = false; }
  return { sent, dropped };
}

/** React hook: how many notes are waiting, plus an automatic flush when the browser comes back online. */
export function useOutbox(onFlushed) {
  const [n, setN] = useState(outboxCount());
  useEffect(() => {
    const upd = () => setN(outboxCount());
    const go = async () => { const r = await flushOutbox(); if (r.sent || r.dropped.length) onFlushed?.(r); upd(); };
    window.addEventListener('pf-outbox', upd);
    window.addEventListener('online', go);
    go();
    return () => { window.removeEventListener('pf-outbox', upd); window.removeEventListener('online', go); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return n;
}
