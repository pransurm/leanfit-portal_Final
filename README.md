# LeanFit Portal

Client check-in portal and coach command centre for LeanFit coaching.

React 18 + Vite frontend, served from Google App Engine Standard (Python 3.11, F1 — free-tier eligible).

---

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

## Production build

```bash
npm run build        # outputs to dist/
npm run preview      # serve the built output locally to sanity-check
```

## Run exactly as App Engine will

```bash
pip install -r requirements.txt
npm run build
python main.py       # http://localhost:8080
```

---

## Deploy to Google App Engine

**The build must run before every deploy.** `dist/` is gitignored and is what
actually gets uploaded — `.gcloudignore` excludes `src/`, `node_modules/`, and
the build tooling, so only `dist/`, `main.py`, `requirements.txt`, and
`app.yaml` are sent.

First time only:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud app create --region=asia-south1      # Mumbai
```

Every deploy:

```bash
npm run build
gcloud app deploy app.yaml
```

Then:

```bash
gcloud app browse
gcloud app logs tail -s default             # live logs
```

### Cost

- `instance_class: F1` with `min_instances: 0` — scales to zero when idle.
- Within App Engine's always-free quota (28 instance-hours/day) this runs at
  $0/month for a small client base.
- `max_instances: 2` is a deliberate cost ceiling. Raise it only if you
  actually need the concurrency.

---

## How routing works

| Request | Served by |
|---|---|
| `/assets/*` | App Engine static handler, cached 1 year (filenames are content-hashed) |
| `/*.png`, `/*.ico`, etc. | App Engine static handler, cached 7 days |
| everything else | Flask (`main.py`) returns `index.html`, uncached |

The catch-all is what makes client-side routes work — a deep link like
`/coach/clients/ankit` returns the SPA shell instead of a 404.

`/healthz` returns `{"status": "ok"}` for uptime checks.

---

## Before going live

- [ ] Replace `CALENDLY_LINK` in `src/LeanFitPortal.jsx` with the real booking URL
- [ ] Replace `REFERRAL_URL` with the real referral landing page
- [ ] Swap in the final logo
- [ ] Point the frontend at a real backend — all data is currently in-memory
      mock data (`SEED`, `COACH_CLIENTS`) and resets on refresh
- [ ] Add authentication before any real client data goes in
