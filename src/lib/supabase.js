import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY; // the public "anon" key; safe in the browser because RLS protects the data

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;

/** Call a Postgres function and throw on error. */
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

/** Await a supabase query builder and throw on error. */
export async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export const isOffline = (err) =>
  !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(String(err?.message || err));

const MESSAGES = [
  ['NOT_VERIFIED', 'Your vet licence has not been verified yet. Add it on your Profile and wait for approval.'],
  ['NOT_VET', 'Only a vet account can do this.'],
  ['DOC_BIG', 'That file is over 10 MB.'],
  ['DOC_TYPE', 'Use a PDF, JPG, PNG or WebP file.'],
  ['IN_THE_PAST', 'Pick a time in the future.'],
  ['BAD_PATH', 'That file could not be stored.'],
  ['CONFIRM_REQUIRED', 'Type DELETE to confirm.'],
  ['check constraint', 'One of the values is out of range. Please check it.'],
  ['ALLERGY_CONFLICT', 'This treatment conflicts with a recorded allergy.'],
  ['DIAGNOSIS_REQUIRED', 'Diagnosis is required.'],
  ['BATCH_REQUIRED', 'Batch number is required when a vaccine is given.'],
  ['REASON_REQUIRED', 'Please describe the emergency (at least 10 characters).'],
  ['NO_ACCESS', 'You no longer have access to this record.'],
  ['REQUEST_EXPIRED', 'This request has expired. Ask the clinic to send a new one, or share with a code.'],
  ['ALREADY_DECIDED', 'This request was already answered.'],
  ['NOT_FOUND', 'We could not find that.'],
  ['PIN_FORMAT', 'The PIN must be exactly 4 digits.'],
  ['PIN_ALREADY_SET', 'A PIN is already set.'],
  ['duplicate key value', 'That microchip number is already registered.'],
  ['chip_check', 'A microchip number has exactly 15 digits.'],
];

/** Turn any thrown error into a short sentence for the screen. */
export function explain(err) {
  if (isOffline(err)) return "You're offline or PawFile can't be reached.";
  const m = String(err?.message || err || '');
  const hit = MESSAGES.find(([k]) => m.includes(k));
  return hit ? hit[1] : 'Something went wrong. Please try again.';
}
