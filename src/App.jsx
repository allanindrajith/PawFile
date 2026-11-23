import React, { useCallback, useEffect, useState } from 'react';
import { configured, supabase } from './lib/supabase.js';
import { Btn, Mascot } from './ui.jsx';
import Login from './live/Login.jsx';
import Setup from './live/Setup.jsx';
import Onboarding from './live/Onboarding.jsx';
import VetApp from './live/VetApp.jsx';
import OwnerApp from './live/OwnerApp.jsx';
import DemoApp from './demo/Demo.jsx';

const Splash = ({ text }) => (
  <div className="splash">
    <Mascot size={140} mood="sleepy" />
    <p className="meta">{text}</p>
  </div>
);

export default function App() {
  const [demo, setDemo] = useState(() => new URLSearchParams(window.location.search).has('demo'));
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(undefined);
  const [loadErr, setLoadErr] = useState('');
  const uid = session?.user?.id;

  useEffect(() => {
    if (!configured) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async () => {
    if (!uid) return;
    // The profile row is created by a database trigger on sign-up; give it a moment.
    for (let i = 0; i < 5; i += 1) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
      if (error) {
        setLoadErr('Could not load your profile. Has supabase/schema.sql been run on this project?');
        return;
      }
      if (data) {
        setProfile(data);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    setLoadErr('Your profile was not created. Has supabase/schema.sql been run on this project?');
  }, [uid]);

  useEffect(() => {
    setProfile(undefined);
    setLoadErr('');
    if (uid) loadProfile();
  }, [uid, loadProfile]);

  const signOut = () => supabase.auth.signOut();
  const leaveDemo = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setDemo(false);
  };

  if (demo) return <DemoApp onExit={leaveDemo} />;

  let screen;
  if (!configured) return <Setup onDemo={() => setDemo(true)} />;
  if (session === undefined) screen = <Splash text="Waking Biscuit up…" />;
  else if (!session) screen = <Login onDemo={() => setDemo(true)} />;
  else if (loadErr) {
    screen = (
      <div className="landing">
        <Mascot size={130} mood="sad" />
        <h1>Hmm, that didn’t load</h1>
        <p className="meta">{loadErr}</p>
        <Btn onClick={loadProfile}>Try again</Btn>
        <Btn kind="secondary" onClick={signOut}>Sign out</Btn>
      </div>
    );
  } else if (profile === undefined) screen = <Splash text="Fetching your account…" />;
  else if (!profile.role || (profile.role === 'vet' && !profile.clinic_id) || (profile.role === 'owner' && !profile.has_pin)) {
    screen = <Onboarding profile={profile} onDone={loadProfile} onSignOut={signOut} />;
  } else if (profile.role === 'vet') screen = <VetApp profile={profile} onSignOut={signOut} onRefresh={loadProfile} />;
  else screen = <OwnerApp profile={profile} onSignOut={signOut} onRefresh={loadProfile} />;

  return (
    <div className="stage">
      <div className="phone">{screen}</div>
    </div>
  );
}
