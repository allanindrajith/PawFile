import React from 'react';
import { Mascot, Paw } from '../ui.jsx';

/** Shown when the Supabase environment variables are missing. */
export default function Setup({ onDemo }) {
  return (
    <div className="stage">
      <div className="phone">
        <div className="landing">
          <div className="logo"><Paw /> PawFile</div>
          <Mascot size={150} mood="wow" />
          <h1>Biscuit needs a database</h1>
          <p className="meta">This app is not connected to Supabase yet. Do these once:</p>
          <ol className="steps">
            <li>Create a free project at supabase.com.</li>
            <li>Run <code>supabase/schema.sql</code> in the SQL Editor.</li>
            <li>Turn on Google under Authentication → Providers, and add your site URL.</li>
            <li>Copy <code>.env.example</code> to <code>.env.local</code> and paste your project URL and anon key.</li>
            <li>Restart <code>npm run dev</code> (or add the same two variables in Vercel).</li>
          </ol>
          <p className="note">The README has every click spelled out.</p>
          <button className="btn outline" onClick={onDemo}>Open the clickable demo meanwhile</button>
        </div>
      </div>
    </div>
  );
}
