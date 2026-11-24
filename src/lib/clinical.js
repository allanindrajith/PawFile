import { rpc, run, supabase } from './supabase.js';
import { fmtChip, fmtDate, ageOf } from './format.js';

/* Data helpers for the clinical features in supabase/upgrade-02-clinical.sql.
   Every read is guarded: if the upgrade has not been run yet, the call resolves to [] / null
   instead of breaking the screen, so the app keeps working on the older schema. */

const safe = async (p, fallback) => {
  try { return await p; } catch (e) { return fallback; }
};

export const loadExtras = async (petId) => {
  const q = (t, order, asc = false) => safe(run(supabase.from(t).select('*').eq('pet_id', petId).order(order, { ascending: asc })), []);
  const [meds, weights, docs, log, amends, appts] = await Promise.all([
    q('medications', 'start_on'),
    q('weight_logs', 'measured_on', true),
    q('pet_documents', 'created_at'),
    q('access_log', 'created_at'),
    q('visit_amendments', 'created_at'),
    q('appointments', 'starts_at', true),
  ]);
  return { meds, weights, docs, log: log.slice(0, 30), amends, appts };
};

export const logView = (petId) => safe(rpc('log_access', { p_pet: petId, p_action: 'view_record' }), null);

export const addMedication = (petId, m) =>
  rpc('add_medication', { p_pet: petId, p_name: m.name, p_dose: m.dose || null, p_freq: m.freq || null, p_end: m.end || null });
export const addWeight = (petId, kg) => rpc('add_weight', { p_pet: petId, p_kg: kg });
export const amendVisit = (v, diagnosis, treatment, reason) =>
  rpc('amend_visit', { p_visit: v, p_diagnosis: diagnosis, p_treatment: treatment || null, p_reason: reason });
export const bookAppointment = (petId, clinicId, at, reason) =>
  rpc('book_appointment', { p_pet: petId, p_clinic: clinicId, p_at: at, p_reason: reason || null });
export const setAppointment = (id, status) => rpc('set_appointment_status', { p_id: id, p_status: status });
export const submitCredential = (license, issuer) => rpc('submit_vet_credential', { p_license: license, p_issuer: issuer || null });
export const addCoowner = (petId, email) => rpc('add_coowner', { p_pet: petId, p_email: email });
export const removeCoowner = (petId, userId) => rpc('remove_coowner', { p_pet: petId, p_user: userId });
export const transferPet = (petId, email, pin) => rpc('transfer_pet', { p_pet: petId, p_email: email, p_pin: pin });
export const setLost = (petId, lost, note) => rpc('set_lost', { p_pet: petId, p_lost: lost, p_note: note || null });
export const acceptTerms = (v) => safe(rpc('accept_terms', { p_version: v }), null);

export async function uploadDocument(petId, file, kind, title, visitId) {
  if (file.size > 10 * 1024 * 1024) throw new Error('DOC_BIG');
  if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(file.type)) throw new Error('DOC_TYPE');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-60);
  const path = `${petId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('pet-docs').upload(path, file, { contentType: file.type });
  if (error) throw error;
  await rpc('add_document', { p_pet: petId, p_kind: kind, p_title: title || file.name, p_path: path, p_visit: visitId || null });
}

export async function openDocument(path) {
  const { data, error } = await supabase.storage.from('pet-docs').createSignedUrl(path, 120);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

/** Everything the owner has stored, as a JSON file download (GDPR access / portability). */
/** Opens a printable report of everything PawFile holds about the person. Save it as a PDF from the print dialog. */
export function openDataReport(data) {
  const d = (x) => (x ? fmtDate(x) : '—');
  const tbl = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">None recorded</td></tr>`}</table>`;
  const me = data.profile || {};
  const pets = (data.pets || []).map((e) => {
    const p = e.pet || {};
    return `<h2>${esc(p.name || 'Pet')}</h2>
<p>${esc([p.species, p.breed, p.sex].filter(Boolean).join(' · '))}${p.birth_date ? ` · born ${esc(d(p.birth_date))}` : ''}${p.chip ? ` · chip ${esc(fmtChip(p.chip))}` : ''}${p.weight_kg ? ` · ${esc(p.weight_kg)} kg` : ''}</p>
<h3>Allergies and alerts</h3>${tbl(['Alert', 'Added by'], (e.alerts || []).map((a) => [a.substance, a.source]))}
<h3>Vaccinations</h3>${tbl(['Vaccine', 'Given', 'Valid until', 'Clinic'], (e.vaccinations || []).map((v) => [v.name, d(v.given_on), d(v.valid_until), v.clinic_name]))}
<h3>Medication</h3>${tbl(['Name', 'Dose', 'Frequency', 'Until'], (e.medications || []).map((m) => [m.name, m.dose, m.frequency, m.end_on ? d(m.end_on) : 'ongoing']))}
<h3>Visits</h3>${tbl(['Date', 'Clinic', 'Diagnosis', 'Treatment'], (e.visits || []).map((v) => [d(v.visit_date), v.clinic_name, v.diagnosis, v.treatment]))}
<h3>Who opened this record</h3>${tbl(['When', 'Who', 'What'], (e.access_log || []).map((l) => [fmtDate(l.created_at), l.actor_name, l.action]))}`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>My PawFile data</title>
<style>body{font:14px/1.5 -apple-system,Inter,system-ui,sans-serif;color:#0f1b2a;margin:32px;max-width:760px}
h1{margin:0 0 2px;font-size:26px}h2{font-size:20px;margin:30px 0 2px;border-top:2px solid #0e7c66;padding-top:12px}h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#0e7c66;margin:16px 0 4px}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #e5e5ea;padding:5px 8px;text-align:left;vertical-align:top}th{font-size:12px;color:#5b6b7b}.k{font-size:11px;color:#5b6b7b;text-transform:uppercase;letter-spacing:.05em}
.note{margin-top:30px;font-size:12px;color:#5b6b7b;border-top:1px solid #e5e5ea;padding-top:10px}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right;padding:8px 14px">Save as PDF</button>
<div class="k">PawFile · your data report</div><h1>${esc(me.full_name || 'Your account')}</h1>
<p>${esc(me.email || '')}${me.phone ? ' · ' + esc(me.phone) : ''} · ${esc(me.role === 'vet' ? 'Veterinarian' : 'Pet owner')}</p>
${pets || '<p>No pets on this account.</p>'}
<div class="note">Generated ${esc(new Date().toLocaleString('en-GB'))}. This is a copy of the information PawFile holds about you.</div></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadMyData() {
  openDataReport(await rpc('export_my_data'));
}

export const deleteAccount = async () => {
  await rpc('delete_my_account', { p_confirm: 'DELETE' });
  await supabase.auth.signOut();
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Open a printable "pet health summary" page; the browser's Print dialog saves it as a PDF.
    It lists what the record says. It is NOT an official EU pet passport and says so on the page. */
export function openPassport(pet, vaccs = [], meds = [], visits = [], issuer = '') {
  const rows = (arr, f) => arr.map(f).join('') || '<tr><td colspan="4">None recorded</td></tr>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Health summary – ${esc(pet.name)}</title>
<style>
  body{font:14px/1.5 Inter,system-ui,sans-serif;color:#0f1b2a;margin:32px;max-width:760px}
  h1{margin:0 0 2px;font-size:26px} h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#0e7c66;margin:26px 0 6px}
  table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #e5e5ea;padding:6px 8px;text-align:left;vertical-align:top}
  th{font-size:12px;color:#5b6b7b;font-weight:600} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 20px}
  .k{font-size:11px;color:#5b6b7b;text-transform:uppercase;letter-spacing:.05em} .note{margin-top:30px;font-size:12px;color:#5b6b7b;border-top:1px solid #e5e5ea;padding-top:10px}
  @media print{button{display:none}}
</style></head><body>
<button onclick="print()" style="float:right;padding:8px 14px">Print / save as PDF</button>
<div class="k">PawFile · pet health summary</div><h1>${esc(pet.name)}</h1>
<div class="grid" style="margin-top:12px">
  <div><div class="k">Species / breed</div>${esc([pet.species, pet.breed].filter(Boolean).join(' · ') || '—')}</div>
  <div><div class="k">Sex</div>${esc(pet.sex || '—')}</div>
  <div><div class="k">Age</div>${esc(ageOf(pet.birth_date) || '—')}</div>
  <div><div class="k">Microchip</div>${esc(pet.chip ? fmtChip(pet.chip) : '—')}</div>
  <div><div class="k">Weight</div>${esc(pet.weight_kg ? pet.weight_kg + ' kg' : '—')}</div>
  <div><div class="k">Date of birth</div>${esc(pet.birth_date ? fmtDate(pet.birth_date) : '—')}</div>
</div>
<h2>Vaccinations</h2>
<table><tr><th>Vaccine</th><th>Given</th><th>Valid until</th><th>Batch · clinic</th></tr>
${rows(vaccs, (v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.given_on ? fmtDate(v.given_on) : '—')}</td><td>${esc(v.valid_until ? fmtDate(v.valid_until) : '—')}</td><td>${esc([v.batch, v.clinic_name].filter(Boolean).join(' · '))}</td></tr>`)}</table>
<h2>Current medication</h2>
<table><tr><th>Name</th><th>Dose</th><th>Frequency</th><th>Until</th></tr>
${rows(meds.filter((m) => !m.end_on || new Date(m.end_on) >= new Date()), (m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.end_on ? fmtDate(m.end_on) : 'ongoing')}</td></tr>`)}</table>
<h2>Recent visits</h2>
<table><tr><th>Date</th><th>Clinic</th><th colspan="2">Diagnosis · treatment</th></tr>
${rows(visits.slice(0, 8), (v) => `<tr><td>${esc(fmtDate(v.visit_date))}</td><td>${esc(v.clinic_name)}</td><td colspan="2">${esc(v.diagnosis)}${v.treatment ? ' · ' + esc(v.treatment) : ''}</td></tr>`)}</table>
<div class="note">Generated ${esc(new Date().toLocaleString('en-GB'))}${issuer ? ' by ' + esc(issuer) : ''} from the PawFile shared record.
This summary is not an official EU pet passport or a veterinary certificate and carries no stamp or signature.</div>
</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
