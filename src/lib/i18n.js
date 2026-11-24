import { useEffect, useState } from 'react';

/* Minimal translation layer: English, Lithuanian, Latvian. Covers navigation, the sign-in page and the
   main buttons. Longer clinical text stays English for now. Lithuanian and Latvian strings should be
   reviewed by a native speaker (ideally a vet) before real use. */

const DICT = {
  en: {
    home: 'Home', access: 'Sharing', chat: 'Messages', profile: 'Profile', today: 'Today', newVisit: 'New visit', signOut: 'Sign out',
    headline: 'One health record for every pet, in every clinic.', language: 'Language',
    search: 'Search', save: 'Save', cancel: 'Cancel', addPet: 'Add a pet', alerts: 'Alerts', vaccinations: 'Vaccinations',
    medications: 'Medications', weight: 'Weight', documents: 'Documents', visits: 'Visit history', activity: 'Access log',
    appointments: 'Appointments',
  },
  lt: {
    home: 'Pradžia', access: 'Prieiga', profile: 'Profilis', today: 'Šiandien', newVisit: 'Naujas vizitas', signOut: 'Atsijungti',
    headline: 'Vienas sveikatos įrašas kiekvienam augintiniui, kiekvienoje klinikoje.', language: 'Kalba',
    search: 'Ieškoti', save: 'Išsaugoti', cancel: 'Atšaukti', addPet: 'Pridėti augintinį', alerts: 'Įspėjimai', vaccinations: 'Vakcinacijos',
    medications: 'Vaistai', weight: 'Svoris', documents: 'Dokumentai', visits: 'Vizitų istorija', activity: 'Prieigos žurnalas',
    appointments: 'Registracijos',
  },
  lv: {
    home: 'Sākums', access: 'Piekļuve', profile: 'Profils', today: 'Šodien', newVisit: 'Jauns apmeklējums', signOut: 'Iziet',
    headline: 'Viens veselības ieraksts katram dzīvniekam, katrā klīnikā.', language: 'Valoda',
    search: 'Meklēt', save: 'Saglabāt', cancel: 'Atcelt', addPet: 'Pievienot dzīvnieku', alerts: 'Brīdinājumi', vaccinations: 'Vakcinācijas',
    medications: 'Zāles', weight: 'Svars', documents: 'Dokumenti', visits: 'Apmeklējumu vēsture', activity: 'Piekļuves žurnāls',
    appointments: 'Pieraksti',
  },
};

export const LANGS = [['en', 'English'], ['lt', 'Lietuvių'], ['lv', 'Latviešu']];
const KEY = 'pawfile.lang';
const pick = () => 'en'; // the app is English only for now

let current = pick();
export const t = (k) => DICT[current]?.[k] ?? DICT.en[k] ?? k;
export const getLang = () => current;
export function setLang(l) {
  if (!DICT[l]) return;
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* blocked */ }
  document.documentElement.lang = l;
  window.dispatchEvent(new Event('pf-lang'));
}

/** Re-render the calling component when the language changes. */
export function useLang() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener('pf-lang', f);
    return () => window.removeEventListener('pf-lang', f);
  }, []);
  return current;
}
