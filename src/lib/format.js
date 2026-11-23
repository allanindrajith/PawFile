export const digits = (s) => (s || '').replace(/\D/g, '');

export const fmtChip = (c) => (c && /^\d{15}$/.test(c) ? c.replace(/(\d{3})(?=\d)/g, '$1 ') : c || '');

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export const fmtUntil = (d) => {
  if (!d) return 'until you stop it';
  const t = new Date(d);
  const sameDay = t.toDateString() === new Date().toDateString();
  return sameDay
    ? `today ${t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function ageOf(birth) {
  if (!birth) return '';
  const b = new Date(birth);
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) months -= 1;
  if (months < 12) return `${Math.max(months, 0)} months`;
  const y = Math.floor(months / 12);
  return `${y} year${y === 1 ? '' : 's'}`;
}

export const petLine = (p) =>
  [p.breed || p.species, p.sex, ageOf(p.birth_date), p.chip ? `Chip ${fmtChip(p.chip)}` : null].filter(Boolean).join(' · ');

export function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One word for where an access request stands right now. */
export function reqState(r) {
  const now = Date.now();
  if (r.status === 'pending') return now - new Date(r.created_at).getTime() > 24 * 3600 * 1000 ? 'expired' : 'pending';
  if (r.status === 'approved') return !r.expires_at || new Date(r.expires_at).getTime() > now ? 'active' : 'ended';
  return r.status; // declined | revoked | reported
}

export const scopeLabel = (s) => (s === 'vaccinations' ? 'Vaccinations only' : 'Full health history');
export const DURATIONS = [
  { id: 'today', label: 'Today only (until 23:59)' },
  { id: '30d', label: '30 days' },
  { id: 'forever', label: 'Until I stop it' },
];
export const durLabel = (id) => DURATIONS.find((d) => d.id === id)?.label || (id === '4h' ? '4 hours (emergency)' : id);

/** Vaccination status for display. */
export function vaccStatus(v) {
  if (!v.valid_until) return { text: 'no expiry date', tone: '' };
  const days = Math.round((new Date(v.valid_until) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days < 0) return { text: `overdue since ${fmtDate(v.valid_until)}`, tone: 'warn' };
  if (days <= 30) return { text: `due in ${days} day${days === 1 ? '' : 's'} (${fmtDate(v.valid_until)})`, tone: 'warn' };
  return { text: `valid until ${fmtDate(v.valid_until)}`, tone: '' };
}
