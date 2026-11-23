# PawFile 🐾

**One health record for every pet, in every clinic.**

In Lithuania a person's health record follows them between doctors. A pet's record does not: each vet clinic keeps its own, so history (allergies, vaccinations, lab results) is lost when a pet changes clinic or crosses a border. PawFile is a shared pet health record where **the owner decides who can see it**, and vets see only what they need, when they need it.

This repo is a working web app (React + Vite + Supabase) with two sides, plus the original clickable Figma-based demo.

| | Vet clinic side | Pet owner side |
|---|---|---|
| Sign in | Google, then choose clinic | Google, then set a 4-digit PIN |
| Find / see pets | Search by microchip or owner's phone, ask for access | Add pets, allergies, vaccinations; see visit history |
| Access | Request, emergency access (reason logged, 4 h), or one-time code | Approve or decline with scope + duration, report an unknown clinic, stop sharing any time |
| Visits | Add a visit, automatic allergy warning, review before sharing, offline retry | Read visits that clinics add |

The mascot is **Biscuit** the Labrador.

## Try it

- **Demo (no account, no database):** open the app and press "Try the clickable demo", or add `?demo` to the URL. Sample data only; nothing is saved.
- **Live app:** needs the Supabase setup below.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the two values (see step 4 below)
npm run dev
```

Without `.env.local` the app shows a setup screen with the demo still available.

## Set up Supabase and Google sign-in (about 15 minutes)

1. **Create a project** at [supabase.com](https://supabase.com) (the free plan is enough).
2. **Create the database.** Supabase dashboard → SQL Editor → New query → paste the whole of [`supabase/schema.sql`](supabase/schema.sql) → Run. It creates the tables, security rules and four sample clinics. It is written for a fresh project.
3. **Turn on Google sign-in.**
   1. [Google Cloud Console](https://console.cloud.google.com) → create a project → *APIs & Services* → *OAuth consent screen* (External; add your own email as a test user while testing).
   2. *Credentials* → *Create credentials* → *OAuth client ID* → type **Web application**.
   3. Under *Authorized redirect URIs* add `https://<your-project-ref>.supabase.co/auth/v1/callback`. Copy the Client ID and Client secret.
   4. Supabase → *Authentication* → *Providers* → *Google* → enable, paste the Client ID and secret, save. The secret lives only in Supabase. Never put it in this repo.
   5. Supabase → *Authentication* → *URL Configuration*: set **Site URL** to your published address (or `http://localhost:5173` while developing) and add every address you use under **Redirect URLs**, for example `http://localhost:5173` and `https://your-app.vercel.app`.
4. **Connect the app.** Supabase → *Project Settings* → *API*. Put the **Project URL** and the **anon public key** in `.env.local` (and in Vercel, below):

   ```
   VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```

   The anon key is meant to be public; the database rules protect the data. **Never** use the `service_role` key in this app.
5. **Test it:** sign in, cancel the Google window, sign out, sign in again. Use two Google accounts to try both sides (one vet, one owner).

## Publish on Vercel

1. Push this repo to GitHub.
2. Vercel → *Add New* → *Project* → import the repo. Defaults work (Vite, `npm run build`, `dist`).
3. Add the two `VITE_SUPABASE_…` variables in *Settings → Environment Variables*, then redeploy.
4. Add the Vercel URL to Supabase *Redirect URLs* (step 3.5 above).

## How access works (the important part)

- **Vets never read pets directly.** A vet can look a pet up by microchip or phone and sees only the name, breed and the owner's first name. The health record opens only through an *active* grant: an approved, unexpired access request for that clinic.
- **The owner chooses** what is shared (full history or vaccinations only) and for how long (today, 30 days, until stopped). Approving needs the owner's 4-digit PIN.
- **Emergency access** needs a written reason (at least 10 characters), lasts 4 hours, and the owner can see it, with the reason, under Access. (There are no push notifications yet.)
- **One-time codes** are 6 digits, work once, for 10 minutes. Five wrong codes lock that vet for 10 minutes.
- **PINs** are stored hashed; five wrong PINs lock the owner for 10 minutes.
- **Rules live in the database** (Postgres row-level security plus `security definer` functions in `supabase/schema.sql`), not in browser code, so a modified browser cannot skip them.

## Project layout

```
src/App.jsx            session + routing (login, setup, onboarding, vet, owner, demo)
src/live/              the real app: Login, Onboarding, VetApp, OwnerApp, Setup
src/demo/Demo.jsx      the original clickable prototype (sample data)
src/ui.jsx             shared components, including the Biscuit mascot
src/lib/               Supabase client, error messages, formatting
supabase/schema.sql    tables, security rules, functions, sample clinics
```

## Known limits (this is a student prototype)

- Owners approve with a **PIN only**. Face ID/biometrics are in the design but need a native app or WebAuthn.
- The PIN cannot be changed or reset yet ("Forgot PIN" is out of scope).
- Clinics are verified by hand in the database (`clinics.verified`). Anyone can add an unverified clinic.
- Emergency access is trusted-with-logging, not pre-approved. There is no audit-log screen.
- No onboarding tour, booking, billing, record import/translation, or multi-language UI. English only.
- Not a medical device. Do not store real patient data without a data-protection review (GDPR).

## Design

The three user jobs and the usability test behind them are in the Figma file *PawFile – Low-fi prototype*: (1) a vet sees the history of a pet from another clinic, (2) a vet adds a visit to the shared record, (3) an owner gives a new clinic access.

## License

[MIT](LICENSE) © 2026 Allan Indrajith
