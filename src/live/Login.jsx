import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Banner, I, Paw } from '../ui.jsx';
import { t, useLang } from '../lib/i18n.js';

const GoogleG = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/** Google/Supabase send errors back in the query string or the hash. Read them once, then clean the URL. */
function readAuthError() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('error') || hash.get('error');
  const desc = params.get('error_description') || hash.get('error_description');
  if (!code) return '';
  window.history.replaceState(null, '', window.location.pathname);
  return code === 'access_denied'
    ? 'Sign-in was cancelled. Nothing was changed; you can try again whenever you’re ready.'
    : `Sign-in failed: ${(desc || code).replace(/\+/g, ' ')}`;
}

export default function Login({ onDemo }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(readAuthError);

  const google = async () => {
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
    } // on success the browser leaves for Google
  };

  return (
    <div className="signin">
      <header className="si-hero">
        <div className="si-brand"><span className="badge"><Paw size={20} /></span> PawFile</div>
        <h1>{t('headline')}</h1>
        <p>Owners decide who can see it. Vets get what they need, when they need it.</p>
        <div className="si-card" aria-hidden="true">
          <span className="si-pet"><Paw size={24} /></span>
          <span className="si-info">
            <b>Max</b>
            <small>Labrador Retriever · 6 years</small>
            <span className="si-tags"><i className="ok">Rabies valid</i><i className="bad">Allergy: Penicillin</i></span>
          </span>
        </div>
      </header>

      <div className="si-body">
        <ul className="si-points">
          <li><span className="ico"><I n="lock" size={20} /></span><b>Owner-controlled</b><small>Shared only with your PIN</small></li>
          <li><span className="ico"><I n="clipboard" size={20} /></span><b>One record</b><small>Same history in every clinic</small></li>
          <li><span className="ico"><I n="steth" size={20} /></span><b>Access logged</b><small>Every view, by name</small></li>
        </ul>

        {err && <Banner kind="err" title="Couldn’t sign you in">{err}</Banner>}

        <button className="google" onClick={google} disabled={busy}>
          <GoogleG /> {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <p className="note">
          You’ll choose whether you’re a vet or a pet owner after signing in. We only receive your name, email and photo from Google.
        </p>
        <p className="note">
          By continuing you agree to the <a href="/terms/">Terms</a> and <a href="/privacy/">Privacy Policy</a>. <a href="/about/">About PawFile</a>
        </p>
        <button className="btn ghost" onClick={onDemo}>Try the clickable demo</button>
      </div>
    </div>
  );
}
