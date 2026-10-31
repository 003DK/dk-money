# 💰 DK Money

Personal money tracker. Add credits/debits with date, category, payment mode and note, then analyse your spending.

- **Frontend:** React (Vite) → GitHub Pages
- **Backend:** Python FastAPI + pandas → Render (free)
- **Database + login:** Supabase (free). Only the email(s) you list can sign in.

```
dk-money/
├── backend/     FastAPI API + pandas analytics
├── frontend/    React app
├── render.yaml  Render deploy config
└── .github/workflows/deploy.yml   auto-deploy to GitHub Pages
```

---------------------------------------------------------------------

## 1. Supabase (database + login)  ~5 min

1. Go to https://supabase.com → **New project** (free). Save the database password.
2. **Settings → API**: copy the **Project URL** and the **anon public key**.
3. **Settings → Database → Connection string → URI** (choose *Session pooler*). Replace `[YOUR-PASSWORD]` with your password. This is `DATABASE_URL`.
4. **Authentication → URL Configuration**:
   - Site URL: `https://YOUR-GITHUB-USERNAME.github.io/dk-money/`
   - Redirect URLs: add the same URL and `http://localhost:5173/`
5. After you have logged in once, go to **Authentication → Sign In / Providers → Email** and turn off **Allow new users to sign up**. (The backend also blocks every email except yours.)

Tables are created automatically on the first run, nothing to set up.

## 2. Run locally (VS Code)  ~5 min

Backend:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows   (Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
set DEV_NO_AUTH=1               # Mac/Linux: export DEV_NO_AUTH=1   (skips login, local testing only)
uvicorn main:app --reload
```
Frontend (new terminal):
```bash
cd frontend
copy .env.example .env          # Mac/Linux: cp .env.example .env   then fill in the 4 values
npm install
npm run dev                     # opens http://localhost:5173
```
For real login locally, skip `DEV_NO_AUTH` and copy `backend/.env.example` to `backend/.env`, fill it in (load it with your shell or `pip install python-dotenv`).

## 3. Deploy backend on Render  ~10 min

1. Push this project to GitHub (step 4 below), then go to https://render.com → **New → Blueprint** → pick the repo. It reads `render.yaml`.
2. Fill the environment variables:
   | Name | Value |
   |---|---|
   | SUPABASE_URL | your Project URL |
   | SUPABASE_ANON_KEY | your anon key |
   | DATABASE_URL | the Supabase connection string |
   | ALLOWED_EMAILS | your email (comma-separate to add more) |
   | CORS_ORIGINS | `https://YOUR-GITHUB-USERNAME.github.io` |
3. Deploy. Your API URL looks like `https://dk-money-api.onrender.com`. Open `/health` to check.

> Free Render servers sleep after ~15 minutes idle. The first request afterwards takes ~30 s, then it is fast. Your data is safe in Supabase.

## 4. Publish with GitHub  ~5 min

```bash
cd dk-money
git init
git add .
git commit -m "DK Money"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/dk-money.git
git push -u origin main
```
(Create the empty repo `dk-money` on github.com first.)

Then in the repo:
1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → New repository secret**, add:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (your Render URL), `VITE_ALLOWED_EMAIL` (your email).
3. Open the **Actions** tab and run **Deploy DK Money** (it also runs on every push).

Your site: `https://YOUR-USERNAME.github.io/dk-money/`

On your phone, open it and use **Add to Home Screen** to get an app icon.

---------------------------------------------------------------------

## Using it
- **+** button: add an entry (Debit/Credit, amount, date picker, category, payment mode, note).
- **Dashboard:** totals, savings %, category pie, payment modes, daily, monthly trend, running balance.
- **Entries:** search, edit, delete, CSV export/import (columns: `date,type,amount,category,mode,note`).
- **Insights (Python/pandas):** plain-language tips, month-over-month by category, weekday pattern, top expenses, unusually large spends, recurring payments, month-end projection.
- **PIN lock:** 4-digit PIN on this device, auto-locks after 1 minute in the background. It is a convenience lock; your real protection is the email login.

## Ideas for later
Monthly budgets with warnings, custom categories, receipts, multiple accounts.
