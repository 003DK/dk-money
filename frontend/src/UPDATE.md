# DK Money update: Friends split + better categories

## Files in this update (copy over the same paths in your project)
backend/main.py
frontend/src/api.js
frontend/src/App.jsx
frontend/src/TxnForm.jsx
frontend/src/Transactions.jsx
frontend/src/Plan.jsx
frontend/src/Dashboard.jsx
frontend/src/Friends.jsx      (NEW file)
frontend/src/styles.css

## Push
git add .
git commit -m "Friends split tally + category rename"
git push

GitHub Actions redeploys the site (about 1-2 min). Render redeploys the API automatically (about 3-5 min).
No new secrets or environment variables. New database tables are created automatically.
