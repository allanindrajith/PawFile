import { rpc, run, supabase } from './supabase.js';

/* Data layer for the Messages tab. Two implementations share one shape so the screen does not care:
   liveChatApi(profile)  -> Supabase (needs supabase/upgrade-04-chat.sql)
   demoChatApi(role)     -> in-memory conversations for the clickable demo */

export function liveChatApi(profile) {
  const me = profile.id;
  return {
    me,
    async listThreads() {
      const threads = await run(supabase.from('chat_threads').select('*').order('last_at', { ascending: false }));
      let unread = [];
      try { unread = await run(supabase.from('chat_messages').select('thread_id').is('read_at', null).neq('sender_id', me)); } catch { /* ignore */ }
      const count = {};
      unread.forEach((m) => { count[m.thread_id] = (count[m.thread_id] || 0) + 1; });
      return threads.map((t) => ({ ...t, unread: count[t.id] || 0 }));
    },
    listMessages: (id) => run(supabase.from('chat_messages').select('*').eq('thread_id', id).order('created_at')),
    send: (id, body) => rpc('send_chat', { p_thread: id, p_body: body }),
    markRead: (id) => rpc('mark_chat_read', { p_thread: id }),
    async startables() {
      const rows = await run(supabase.from('access_requests').select('*').in('status', ['approved', 'revoked']).order('created_at', { ascending: false }));
      const seen = new Set();
      const out = [];
      rows.forEach((r) => {
        if (profile.role === 'owner' && !r.requested_by) return;
        const key = profile.role === 'owner' ? `${r.pet_id}:${r.requested_by}` : r.pet_id;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(profile.role === 'owner'
          ? { key, pet_id: r.pet_id, vet_id: r.requested_by, label: r.requested_by_name || 'Clinic', sub: `Veterinarian · about ${r.pet_name}` }
          : { key, pet_id: r.pet_id, vet_id: null, label: `Owner of ${r.pet_name}`, sub: 'Open a conversation about this pet' });
      });
      return out;
    },
    start: (s) => rpc('start_thread', { p_pet: s.pet_id, p_vet: s.vet_id }),
    subscribe(cb) {
      if (!supabase) return () => {};
      const ch = supabase.channel(`pf-chat-${Math.random().toString(36).slice(2, 8)}`);
      ['chat_messages', 'chat_threads'].forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb()));
      ch.subscribe();
      return () => supabase.removeChannel(ch);
    },
  };
}

/* ---------- demo ---------- */
const mins = (n) => new Date(Date.now() - n * 60000).toISOString();
const store = {
  threads: [
    { id: 't1', pet_name: 'Max', owner_name: 'Laura Kalnina', owner_id: 'demo-owner', vet_id: 'demo-vet-riga', vet_name: 'Dr. Ilze Ozola', clinic_name: 'Riga Vet Centre', last_body: 'Max’s bloodwork looks normal. No action needed.', last_at: mins(1500), unread: 0 },
    { id: 't2', pet_name: 'Max', owner_name: 'Laura Kalnina', owner_id: 'demo-owner', vet_id: 'demo-vet', vet_name: 'Dr. Tomas Kazlauskas', clinic_name: 'Vilnius Animal Clinic', last_body: 'Please keep him off the amoxicillin, we’ll switch to meloxicam.', last_at: mins(35), unread: 1 },
  ],
  messages: {
    t1: [
      { id: 'm1', sender_id: 'demo-owner', sender_name: 'Laura Kalnina', body: 'Hi Dr. Ozola, did the bloodwork from January come back?', created_at: mins(1600) },
      { id: 'm2', sender_id: 'demo-vet-riga', sender_name: 'Dr. Ilze Ozola', body: 'Max’s bloodwork looks normal. No action needed.', created_at: mins(1500) },
    ],
    t2: [
      { id: 'm3', sender_id: 'demo-owner', sender_name: 'Laura Kalnina', body: 'Hello doctor, Max is still limping a little this morning. Is that normal?', created_at: mins(60) },
      { id: 'm4', sender_id: 'demo-vet', sender_name: 'Dr. Tomas Kazlauskas', body: 'A little stiffness is common after a sprain. Rest him for two more days.', created_at: mins(50) },
      { id: 'm5', sender_id: 'demo-vet', sender_name: 'Dr. Tomas Kazlauskas', body: 'Please keep him off the amoxicillin, we’ll switch to meloxicam.', created_at: mins(35) },
    ],
  },
};
const listeners = new Set();
const ping = () => listeners.forEach((f) => f());
const REPLIES = {
  owner: ['Thanks Laura, I’ll update Max’s plan today.', 'Understood. Send a photo if the swelling gets worse.'],
  vet: ['Thank you, doctor. I’ll keep you posted.', 'Great, I’ll bring him in on Monday.'],
};
let replyN = 0;

export function demoChatApi(role) {
  const me = role === 'vet' ? 'demo-vet' : 'demo-owner';
  const mine = (t) => (role === 'vet' ? t.vet_id === 'demo-vet' : true);
  return {
    me,
    listThreads: async () => store.threads.filter(mine).slice().sort((a, b) => new Date(b.last_at) - new Date(a.last_at)),
    listMessages: async (id) => (store.messages[id] || []).slice(),
    async send(id, body) {
      const t = store.threads.find((x) => x.id === id);
      const name = role === 'vet' ? 'Dr. Tomas Kazlauskas' : 'Laura Kalnina';
      (store.messages[id] ||= []).push({ id: `m${Date.now()}`, sender_id: me, sender_name: name, body, created_at: new Date().toISOString() });
      t.last_body = body; t.last_at = new Date().toISOString(); t.unread = 0;
      ping();
      setTimeout(() => {
        const fromId = role === 'vet' ? 'demo-owner' : t.vet_id;
        const fromName = role === 'vet' ? 'Laura Kalnina' : t.vet_name;
        const text = REPLIES[role][replyN++ % 2];
        store.messages[id].push({ id: `m${Date.now()}`, sender_id: fromId, sender_name: fromName, body: text, created_at: new Date().toISOString() });
        t.last_body = text; t.last_at = new Date().toISOString();
        ping();
      }, 1800);
    },
    async markRead(id) { const t = store.threads.find((x) => x.id === id); if (t) t.unread = 0; },
    startables: async () => (role === 'vet' ? [] : [{ key: 'k', pet_id: 'max', vet_id: 'demo-vet-tartu', label: 'Tartu Lemmikloomakliinik', sub: 'Access ended · about Max' }]),
    async start() { return 't1'; },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}
