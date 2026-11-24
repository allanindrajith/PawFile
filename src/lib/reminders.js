import { fmtDateTime } from './format.js';

/** Reminders computed from the record: vaccines due or expired, medicine courses ending, appointments within 48 h. */
export function remindersFor(vaccs = [], meds = [], appts = []) {
  const out = [];
  const day = 864e5;
  const now = Date.now();
  vaccs.forEach((v) => {
    if (!v.valid_until) return;
    const d = Math.ceil((new Date(v.valid_until).getTime() - now) / day);
    if (d < 0) out.push({ id: `v${v.id}`, tone: 'warn', text: `${v.name} expired ${-d} day${d === -1 ? '' : 's'} ago` });
    else if (d <= 30) out.push({ id: `v${v.id}`, tone: 'warn', text: `${v.name} is due in ${d} day${d === 1 ? '' : 's'}` });
  });
  meds.forEach((m) => {
    if (!m.end_on) return;
    const d = Math.ceil((new Date(m.end_on).getTime() - now) / day);
    if (d >= 0 && d <= 3) out.push({ id: `m${m.id}`, tone: 'info', text: `${m.name} course ends ${d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}` });
  });
  appts.filter((a) => a.status === 'booked').forEach((a) => {
    const h = (new Date(a.starts_at).getTime() - now) / 36e5;
    if (h >= 0 && h <= 48) out.push({ id: `a${a.id}`, tone: 'info', text: `Appointment ${fmtDateTime(a.starts_at)}` });
  });
  return out;
}
