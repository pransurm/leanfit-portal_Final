# LeanFit Portal — Cloud Native Platform

Client check-in portal and coach command centre for LeanFit coaching.

- **Frontend**: React 18 + Vite SPA, served via Google App Engine Standard (`service: default`, F1 instance).
- **Backend API**: Python 3.11 + FastAPI + Firebase Admin SDK, served via Google App Engine Standard (`service: api`, F1 instance).
- **Routing**: Single-domain zero-CORS architecture managed by App Engine `dispatch.yaml`.
- **Database**: Cloud Firestore (Native mode, `asia-south1` Mumbai).
- **Authentication**: Firebase Authentication with custom claims (`role: coach` / `role: client`).
- **Object Storage**: Cloud Storage private buckets with V4 Signed URLs (15-min TTL) for progress photos and blood report PDFs.

---

## Architecture Overview

```
                        https://your-appspot-domain.com
                                      │
                               ┌──────┴──────┐
                               │dispatch.yaml│
                               └──────┬──────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               │                                             │
      URL path: /*                                  URL path: /api/*
               ▼                                             ▼
       service: default                               service: api
    (Flask SPA File Server)                        (FastAPI REST Backend)
               │                                             │
      Serves dist/ React 18                          ┌───────┴───────┐
                                                     │               │
                                                     ▼               ▼
                                            Cloud Firestore   Cloud Storage
                                             (Native Mode)    (Signed URLs)
```

---

## Data Standards & Business Rules

1. **Date Format**: Standardized to `DD-MM-YYYY` (e.g. `08-09-2026`) across all countries.
2. **Traffic Light Classification**:
   - 🟢 **Green**: Consistently updating check-ins, steady progress, adherence $\ge 75\%$, active streak.
   - 🟡 **Yellow**: Fewer check-ins, progress not up to mark ($1-2$ days missed, adherence $45\%-74\%$).
   - 🔴 **Red**: Rarely or not checking in ($\ge 3$ days inactive, adherence $< 45\%$, streak $= 0$).
   - ⏸️ **Paused**: Program on hold with expected return date.
3. **Adherence Formula (Weighted + Proportional)**:
   - Meals: 40% (proportional to 5 meals)
   - Steps: 30% (proportional to daily step goal)
   - Hydration: 20% (proportional to 3.0 Litres)
   - Vitamins: 10% (multivitamin adherence)
4. **Security & Data Isolation**:
   - Client isolation enforced by Firestore security rules.
   - Coach notes (`coachNote`) are strictly redacted from any client API responses.
   - Photos and blood reports are private; accessed only through short-lived V4 signed URLs.

---

## Local Development

### 1. Backend (FastAPI)

```bash
cd api
pip install -r requirements.txt
uvicorn api.main:app --port 8080 --reload
```

Health check: `http://localhost:8080/api/health`

### 2. Frontend (Vite)

In root directory:

```bash
npm install
npm run dev          # http://localhost:5173
```
*Note: Vite dev server automatically proxies `/api/*` to `http://127.0.0.1:8080`.*

### 3. Seed Database (Optional)

To seed initial mock data for Ankit, Ninad, Srikanth, Gaurav, and Coach Ram:

```bash
python api/seed.py
```

### 4. Run Automated Calculations Test

```bash
python -m unittest api/test_calculations.py
```

---

## Deployment to Google Cloud

### Prerequisites

1. Set up Google Cloud CLI and select project:
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```
2. Enable App Engine in `asia-south1` (Mumbai):
```bash
gcloud app create --region=asia-south1
```

### Deploy Firestore Security Rules & Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### Deploy Services & Routing

```bash
# 1. Build frontend production bundle
npm run build

# 2. Deploy default service (Frontend)
gcloud app deploy app.yaml

# 3. Deploy api service (FastAPI Backend)
gcloud app deploy api/app.yaml

# 4. Deploy dispatch routing rules
gcloud app deploy dispatch.yaml
```

After deployment:
```bash
gcloud app browse
gcloud app logs tail -s api        # Stream backend API logs
gcloud app logs tail -s default    # Stream frontend logs
```

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `GCP_PROJECT` | Google Cloud Project ID |
| `GCS_BUCKET` | Cloud Storage bucket for photos and reports |
| `SIGNED_URL_EXPIRATION_MINUTES` | TTL for signed URLs (default: 15) |
| `VITE_FIREBASE_API_KEY` | Firebase Web SDK API Key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket |
