import uuid
from datetime import datetime, date, timezone
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Query, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.config import settings
from api.database import get_db
from api.auth import get_current_user, require_coach, AuthenticatedUser
from api.calculations import (
    parse_date_dmy,
    format_date_dmy,
    calc_adherence,
    calc_streak,
    classify_traffic_light,
    get_client_alerts,
    calc_body_fat
)
from api.storage import generate_signed_upload_url, generate_signed_read_url
from api.create_client import generate_tough_password

app = FastAPI(
    title="LeanFit Portal API",
    version="1.0.0",
    description="Google Cloud Native Backend for LeanFit Portal"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")

# ═══ SCHEMAS ═══════════════════════════════════════════════════════════
class CheckInPayload(BaseModel):
    date: Optional[str] = None          # Display date, e.g. "8/9"
    fullDate: str                       # Standardized "DD-MM-YYYY" (e.g. "08-09-2026")
    w: float                            # Body weight
    steps: int
    wrk: int                            # Workout sessions completed this week
    meals: int                          # Nutrition adherence 1-5
    mealNote: Optional[str] = ""
    water: float                        # Litres of water
    multi: bool                         # Multivitamin adherence
    e: int                              # Energy 1-10
    sl: int                             # Sleep hours 1-10
    st: int                             # Stress level 1-10
    bed: Optional[str] = ""
    wake: Optional[str] = ""
    note: Optional[str] = ""

class MeasurementPayload(BaseModel):
    week: int
    date: Optional[str] = None          # Standardized DD-MM-YYYY or "8 Sep"
    arms: Optional[float] = None
    waist: Optional[float] = None
    quads: Optional[float] = None
    chest: Optional[float] = None
    shoulders: Optional[float] = None
    hips: Optional[float] = None
    neck: Optional[float] = None
    photoFrontGcsPath: Optional[str] = None
    photoSideGcsPath: Optional[str] = None
    photoBackGcsPath: Optional[str] = None

class WinPayload(BaseModel):
    week: int
    date: Optional[str] = None
    emoji: str = "💪"
    text: str

class CheckinDeletePayload(BaseModel):
    reason: str

class ReportConfirmPayload(BaseModel):
    name: str
    gcsPath: str
    sizeBytes: int = 0
    sizeDisp: Optional[str] = None
    date: Optional[str] = None

class PlanUpdatePayload(BaseModel):
    nutriPlan: Optional[str] = None
    workPlan: Optional[str] = None

class StatusUpdatePayload(BaseModel):
    status: str                         # "active" or "paused"
    pauseReason: Optional[str] = None
    resumeDate: Optional[str] = None

class NoteUpdatePayload(BaseModel):
    coachNote: str

class ClientCreatePayload(BaseModel):
    name: str
    email: str
    initials: Optional[str] = None
    phase: str = "Phase I"
    week: int = 1
    startDate: str
    endDate: Optional[str] = None
    startW: float
    targetW: Optional[float] = None
    height: float = 175.0
    city: str = "Mumbai"
    prog: str = "LeanFit 6-Month Transformation"
    coachStepsGoal: int = 8000


# ═══ HEALTH ENDPOINTS ══════════════════════════════════════════════════
@app.get("/healthz")
@app.get("/health")
@api_router.get("/health")
def health_check():
    return {"status": "ok", "service": "api", "project": settings.PROJECT_ID}


# ═══ AUTH / USER IDENTITY ═════════════════════════════════════════════
@api_router.get("/me")
def get_me(user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_data = {}
    if user.client_id:
        doc = db.collection("clients").document(user.client_id).get()
        if doc.exists:
            client_data = doc.to_dict()
            if not user.is_coach and "coachNote" in client_data:
                del client_data["coachNote"]

    return {
        "uid": user.uid,
        "email": user.email,
        "role": user.role,
        "clientId": user.client_id,
        "client": client_data
    }


# ═══ CLIENT DATA & CHECK-INS ═════════════════════════════════════════
@api_router.get("/client/data")
def get_client_data(user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)
    client_doc = client_ref.get()

    if not client_doc.exists and user.email:
        # Fallback: look up clients collection by email
        matches = list(db.collection("clients").where("email", "==", user.email.lower()).limit(1).stream())
        if matches:
            client_doc = matches[0]
            client_id = client_doc.id
            client_ref = db.collection("clients").document(client_id)
            # Self-heal: Link users/{uid} to this clientId
            try:
                db.collection("users").document(user.uid).set({
                    "uid": user.uid,
                    "email": user.email,
                    "clientId": client_id,
                    "role": "client"
                }, merge=True)
            except Exception:
                pass

    if not client_doc.exists:
        # Determine fallback name from user email or name
        name = "Pranshur"
        if user.email:
            prefix = user.email.split("@")[0].replace(".", " ").replace("_", " ").title()
            name = prefix or "Pranshur"
        return {
            "client": {"id": client_id, "name": name, "phase": "Phase I", "week": 1, "coachStepsGoal": 8000},
            "checkins": [],
            "measurements": [],
            "wins": [],
            "reports": [],
            "onboarding": None,
            "adherence": {"meals": 0, "steps": 0, "water": 0, "vitamins": 0, "overall": 0},
            "streak": 0,
            "trafficLight": "am",
            "plans": {"nutrition": None, "workout": None}
        }

    client = client_doc.to_dict()
    client["id"] = client_id

    # CRITICAL SECURITY RULE: Strip private coach note from client response
    if not user.is_coach and "coachNote" in client:
        del client["coachNote"]

    steps_goal = client.get("coachStepsGoal", 8000)

    # Fetch daily check-ins (excluding soft-deleted)
    checkins_query = client_ref.collection("checkins").stream()
    checkins = []
    for c in checkins_query:
        c_dict = c.to_dict()
        if not c_dict.get("deleted", False):
            c_dict["id"] = c.id
            checkins.append(c_dict)

    # Sort chronologically by fullDate
    def parse_sort_key(c):
        d = parse_date_dmy(c.get("fullDate", ""))
        return d if d else date.min

    checkins.sort(key=parse_sort_key)

    # Fetch measurements & attach signed download URLs for photos
    measurements_query = client_ref.collection("measurements").stream()
    measurements = []
    for m in measurements_query:
        m_data = m.to_dict()
        m_data["id"] = m.id
        if m_data.get("photoFrontGcsPath"):
            m_data["photoFrontUrl"] = generate_signed_read_url(m_data["photoFrontGcsPath"])
        if m_data.get("photoSideGcsPath"):
            m_data["photoSideUrl"] = generate_signed_read_url(m_data["photoSideGcsPath"])
        if m_data.get("photoBackGcsPath"):
            m_data["photoBackUrl"] = generate_signed_read_url(m_data["photoBackGcsPath"])
        measurements.append(m_data)
    measurements.sort(key=lambda x: x.get("week", 0))

    # Fetch wins
    wins_query = client_ref.collection("wins").stream()
    wins = [w.to_dict() for w in wins_query]
    wins.sort(key=lambda x: x.get("week", 0))

    # Fetch blood reports & attach signed download URLs
    reports_query = client_ref.collection("reports").stream()
    reports = []
    for r in reports_query:
        r_data = r.to_dict()
        r_data["id"] = r.id
        if r_data.get("gcsPath"):
            r_data["downloadUrl"] = generate_signed_read_url(r_data["gcsPath"])
        reports.append(r_data)

    # Fetch onboarding intake if available
    onboarding_doc = client_ref.collection("onboarding").document("intake").get()
    onboarding = onboarding_doc.to_dict() if onboarding_doc.exists else None

    # Calculate adherence & streak dynamically or use cached
    adh = calc_adherence(checkins, steps_goal)
    dates_list = [parse_date_dmy(c.get("fullDate", "")) for c in checkins if parse_date_dmy(c.get("fullDate", ""))]
    streak, days_since, checked_in = calc_streak(dates_list)

    tl = classify_traffic_light({
        "status": client.get("status", "active"),
        "daysSince": days_since,
        "streak": streak,
        "adherence": adh
    })

    return {
        "client": client,
        "checkins": checkins,
        "measurements": measurements,
        "wins": wins,
        "reports": reports,
        "onboarding": onboarding,
        "adherence": adh,
        "streak": streak,
        "daysSince": days_since,
        "checkedIn": checked_in,
        "trafficLight": tl,
        "plans": {
            "nutrition": client.get("nutriPlan"),
            "workout": client.get("workPlan"),
            "updatedAt": client.get("plansUpdatedAt")
        }
    }


@api_router.post("/client/checkin")
def post_checkin(payload: CheckInPayload, user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)

    # Ensure fullDate is standardized DD-MM-YYYY
    parsed_date = parse_date_dmy(payload.fullDate)
    if not parsed_date:
        raise HTTPException(status_code=400, detail="Invalid date format. Expected DD-MM-YYYY.")

    doc_id = format_date_dmy(parsed_date)
    display_date = payload.date or f"{parsed_date.day}/{parsed_date.month}"

    checkin_data = {
        "date": display_date,
        "fullDate": doc_id,
        "w": float(payload.w),
        "steps": int(payload.steps),
        "wrk": int(payload.wrk),
        "meals": int(payload.meals),
        "mealNote": payload.mealNote or "",
        "water": float(payload.water),
        "multi": bool(payload.multi),
        "e": int(payload.e),
        "sl": int(payload.sl),
        "st": int(payload.st),
        "bed": payload.bed or "",
        "wake": payload.wake or "",
        "note": payload.note or "",
        "createdAt": datetime.now(timezone.utc).isoformat()
    }

    # Save idempotent daily checkin
    client_ref.collection("checkins").document(doc_id).set(checkin_data, merge=True)

    # Fetch all checkins to update cached parent metrics
    all_checkins_query = client_ref.collection("checkins").stream()
    all_checkins = [c.to_dict() for c in all_checkins_query]

    client_doc = client_ref.get()
    steps_goal = client_doc.to_dict().get("coachStepsGoal", 8000) if client_doc.exists else 8000

    adh = calc_adherence(all_checkins, steps_goal)
    dates_list = [parse_date_dmy(c.get("fullDate", "")) for c in all_checkins if parse_date_dmy(c.get("fullDate", ""))]
    streak, days_since, checked_in = calc_streak(dates_list)

    tl = classify_traffic_light({
        "status": client_doc.to_dict().get("status", "active") if client_doc.exists else "active",
        "daysSince": days_since,
        "streak": streak,
        "adherence": adh
    })

    # Update parent client profile with derived cached fields
    client_ref.set({
        "latestW": checkin_data["w"],
        "latestMeals": checkin_data["meals"],
        "latestSteps": checkin_data["steps"],
        "latestWater": checkin_data["water"],
        "latestStress": checkin_data["st"],
        "latestEnergy": checkin_data["e"],
        "daysSince": days_since,
        "checkedIn": checked_in,
        "streak": streak,
        "adherence": adh,
        "trafficLight": tl,
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }, merge=True)

    return {
        "status": "ok",
        "checkin": checkin_data,
        "adherence": adh,
        "streak": streak,
        "daysSince": days_since,
        "trafficLight": tl
    }


@api_router.post("/client/measurement")
def post_measurement(payload: MeasurementPayload, user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)

    client_doc = client_ref.get()
    height_cm = client_doc.to_dict().get("height", 175.0) if client_doc.exists else 175.0

    # Auto calculate US Military body fat
    bf_pct = calc_body_fat(
        waist_cm=payload.waist,
        neck_cm=payload.neck,
        height_cm=height_cm,
        hips_cm=payload.hips
    )

    meas_data = {
        "week": payload.week,
        "date": payload.date or datetime.now(timezone.utc).strftime("%d %b %Y"),
        "arms": payload.arms,
        "waist": payload.waist,
        "quads": payload.quads,
        "chest": payload.chest,
        "shoulders": payload.shoulders,
        "hips": payload.hips,
        "neck": payload.neck,
        "bodyFatPct": bf_pct,
        "photoFrontGcsPath": payload.photoFrontGcsPath,
        "photoSideGcsPath": payload.photoSideGcsPath,
        "photoBackGcsPath": payload.photoBackGcsPath,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }

    meas_id = f"week_{payload.week}"
    client_ref.collection("measurements").document(meas_id).set(meas_data, merge=True)

    return {"status": "ok", "measurement": meas_data}


@api_router.post("/client/wins")
def post_win(payload: WinPayload, user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)

    win_data = {
        "week": payload.week,
        "date": payload.date or datetime.now(timezone.utc).strftime("%d %b %Y"),
        "emoji": payload.emoji,
        "text": payload.text,
        "createdAt": datetime.now(timezone.utc).isoformat()
    }

    win_id = f"win_{payload.week}_{int(datetime.now(timezone.utc).timestamp())}"
    client_ref.collection("wins").document(win_id).set(win_data)
    return {"status": "ok", "win": win_data}


@api_router.post("/client/onboarding")
def save_onboarding(payload: Dict[str, Any] = Body(...), user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)

    # Save intake answers
    client_ref.collection("onboarding").document("intake").set(payload, merge=True)

    # Update basic profile data from onboarding
    updates = {}
    if "name" in payload:
        updates["name"] = payload["name"]
    if "measUnit" in payload:
        updates["measUnit"] = payload["measUnit"]
    if "weightUnit" in payload:
        updates["weightUnit"] = payload["weightUnit"]
    if "height" in payload:
        try:
            h = float(payload["height"])
            if payload.get("measUnit") == "inches":
                updates["heightInches"] = h
                updates["height"] = round(h * 2.54, 1)
            else:
                updates["height"] = h
                updates["heightInches"] = round(h / 2.54, 1)
        except (ValueError, TypeError):
            pass
    if "weight" in payload:
        try:
            w = float(payload["weight"])
            if payload.get("weightUnit") == "lbs":
                updates["startWLbs"] = w
                updates["startW"] = round(w * 0.453592, 2)
                updates["latestW"] = round(w * 0.453592, 2)
            else:
                updates["startW"] = w
                updates["latestW"] = w
                updates["startWLbs"] = round(w * 2.20462, 1)
        except (ValueError, TypeError):
            pass

    if updates:
        client_ref.set(updates, merge=True)

    return {"status": "ok"}


@api_router.post("/public/onboarding/complete")
def complete_public_onboarding(payload: Dict[str, Any] = Body(...)):
    """
    Public intake registration endpoint:
    - Generates tough password (14 chars)
    - Provisions Firebase Auth user & claims
    - Creates Firestore users/{uid} and clients/{clientId} with baseline metrics
    - Creates Coach Ram notification with credentials
    - Returns credentials & profile for on-screen display
    """
    db = get_db()
    name = (payload.get("name") or "New Client").strip()
    email = (payload.get("email") or "").strip().lower()

    clean_name = "".join(c for c in name.lower() if c.isalnum())
    if not clean_name:
        clean_name = f"client_{uuid.uuid4().hex[:6]}"
    client_id = clean_name
    if not email:
        email = f"{client_id}@leanfit.io"

    user_password = payload.get("password") or generate_tough_password(14)
    passed_uid = payload.get("uid")
    uid = passed_uid or client_id
    weight_unit = payload.get("weightUnit", "kg")
    meas_unit = payload.get("measUnit", "cm")

    try:
        raw_w = float(payload.get("weight", 70.0))
    except (ValueError, TypeError):
        raw_w = 70.0

    if weight_unit == "lbs":
        start_w_lbs = raw_w
        start_w = round(raw_w * 0.453592, 2)
    else:
        start_w = raw_w
        start_w_lbs = round(raw_w * 2.20462, 1)

    try:
        raw_h = float(payload.get("height", 175.0))
    except (ValueError, TypeError):
        raw_h = 175.0

    if meas_unit == "inches":
        height_in = raw_h
        height_cm = round(raw_h * 2.54, 1)
    else:
        height_cm = raw_h
        height_in = round(raw_h / 2.54, 1)

    # 1. Firebase Auth user creation / claims sync
    def try_firebase_auth():
        nonlocal uid
        try:
            from firebase_admin import auth as firebase_auth
            user = None
            try:
                user = firebase_auth.get_user_by_email(email)
                uid = user.uid
                firebase_auth.update_user(uid, password=user_password)
                print(f"[AUTH OK] Updated existing Firebase user password for {email} (UID: {uid})", flush=True)
            except Exception:
                pass

            if user is None:
                try:
                    create_args = {
                        "email": email,
                        "password": user_password,
                        "display_name": name
                    }
                    if passed_uid:
                        create_args["uid"] = passed_uid
                    user = firebase_auth.create_user(**create_args)
                    uid = user.uid
                    print(f"[AUTH OK] Created new Firebase user for {email} (UID: {uid})", flush=True)
                except Exception as e:
                    print(f"[AUTH WARN] Could not create user in Firebase Admin: {e}", flush=True)

            try:
                firebase_auth.set_custom_user_claims(uid, {"role": "client", "clientId": client_id})
                print(f"[AUTH OK] Set custom claims for {uid}: role=client, clientId={client_id}", flush=True)
            except Exception as e:
                print(f"[AUTH WARN] Could not set custom claims: {e}", flush=True)
        except Exception as e:
            print(f"[AUTH WARN] Firebase Admin Auth error: {e}", flush=True)

    t = threading.Thread(target=try_firebase_auth, daemon=True)
    t.start()
    t.join(timeout=10.0)

    # 2. Firestore: users/{uid}
    try:
        user_ref = db.collection("users").document(uid)
        user_ref.set({
            "uid": uid,
            "email": email,
            "name": name,
            "role": "client",
            "clientId": client_id,
            "updatedAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
    except Exception as e:
        print(f"[DB WARN] Firestore users doc notice: {e}", flush=True)

    # 3. Firestore: clients/{client_id}
    client_data = {
        "name": name,
        "initials": "".join([p[0].upper() for p in name.split()[:2]]) or "LF",
        "email": email,
        "phase": "Phase I",
        "week": 1,
        "startDate": datetime.now(timezone.utc).strftime("%d-%m-%Y"),
        "startW": start_w,
        "startWLbs": start_w_lbs,
        "latestW": start_w,
        "height": height_cm,
        "heightInches": height_in,
        "city": payload.get("city", ""),
        "prog": "LeanFit 6-Month Transformation",
        "coachStepsGoal": 8000,
        "weightUnit": weight_unit,
        "measUnit": meas_unit,
        "status": "active",
        "trafficLight": "g",
        "adherence": {"meals": 100, "steps": 100, "water": 100, "vitamins": 100, "overall": 100},
        "streak": 1,
        "daysSince": 0,
        "checkedIn": False,
        "coachNote": f"Initial baseline weight {start_w} {weight_unit}. Goal: {payload.get('goal', 'Fat loss & recomposition')}.",
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    try:
        client_ref = db.collection("clients").document(client_id)
        client_ref.set(client_data, merge=True)
        # Store full intake
        client_ref.collection("onboarding").document("intake").set(payload, merge=True)
        # Baseline measurement
        client_ref.collection("measurements").document("baseline").set({
            "week": 0,
            "date": datetime.now(timezone.utc).strftime("%d-%m-%Y"),
            "weight": start_w,
            "arms": float(payload.get("mArms")) if payload.get("mArms") else None,
            "waist": float(payload.get("mWaist")) if payload.get("mWaist") else None,
            "quads": float(payload.get("mQuads")) if payload.get("mQuads") else None,
            "chest": float(payload.get("mChest")) if payload.get("mChest") else None,
            "shoulders": float(payload.get("mShoulders")) if payload.get("mShoulders") else None,
            "hips": float(payload.get("mHips")) if payload.get("mHips") else None,
            "neck": float(payload.get("mNeck")) if payload.get("mNeck") else None,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
    except Exception:
        pass

    # 4. Coach notification
    try:
        notif_ref = db.collection("coach_notifications").document(f"notif_{client_id}")
        notif_ref.set({
            "id": f"notif_{client_id}",
            "type": "NEW_CLIENT_ADDED",
            "title": f"New Client Registered: {name}",
            "body": f"{name} completed intake. Weight: {start_w} {weight_unit}. Email: {email}, Password: {tough_password}",
            "clientId": client_id,
            "credentials": {
                "email": email,
                "password": tough_password
            },
            "read": False,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
    except Exception:
        pass

    return {
        "status": "ok",
        "clientId": client_id,
        "email": email,
        "password": tough_password,
        "name": name,
        "startW": start_w,
        "startWLbs": start_w_lbs,
        "height": height_cm,
        "weightUnit": weight_unit,
        "measUnit": meas_unit
    }


# ═══ FILE UPLOADS (SIGNED URLS) ═══════════════════════════════════════
@api_router.post("/client/reports/upload-url")
def get_report_upload_url(payload: Dict[str, str] = Body(...), user: AuthenticatedUser = Depends(get_current_user)):
    filename = payload.get("fileName", "blood_report.pdf")
    content_type = payload.get("contentType", "application/pdf")
    unique_id = uuid.uuid4().hex[:8]
    clean_name = "".join(c for c in filename if c.isalnum() or c in (".", "_", "-"))
    gcs_path = f"clients/{user.client_id}/reports/{unique_id}_{clean_name}"

    upload_url = generate_signed_upload_url(gcs_path, content_type)
    return {"uploadUrl": upload_url, "gcsPath": gcs_path, "cleanName": clean_name}


@api_router.post("/client/reports/confirm")
def confirm_report_upload(payload: ReportConfirmPayload, user: AuthenticatedUser = Depends(get_current_user)):
    db = get_db()
    client_id = user.client_id
    client_ref = db.collection("clients").document(client_id)

    report_id = str(uuid.uuid4())
    report_data = {
        "name": payload.name,
        "gcsPath": payload.gcsPath,
        "sizeBytes": payload.sizeBytes,
        "sizeDisp": payload.sizeDisp or f"{round(payload.sizeBytes / (1024 * 1024), 1)} MB",
        "date": payload.date or datetime.now(timezone.utc).strftime("%d %b %Y"),
        "uploadedAt": datetime.now(timezone.utc).isoformat()
    }

    client_ref.collection("reports").document(report_id).set(report_data)
    report_data["id"] = report_id
    report_data["downloadUrl"] = generate_signed_read_url(payload.gcsPath)

    return {"status": "ok", "report": report_data}


@api_router.post("/client/photos/upload-url")
def get_photo_upload_url(payload: Dict[str, Any] = Body(...), user: AuthenticatedUser = Depends(get_current_user)):
    filename = payload.get("fileName", "photo.jpg")
    slot = payload.get("slot", "front") # front, side, back
    week = payload.get("week", 1)
    content_type = payload.get("contentType", "image/jpeg")

    unique_id = uuid.uuid4().hex[:8]
    clean_name = "".join(c for c in filename if c.isalnum() or c in (".", "_", "-"))
    gcs_path = f"clients/{user.client_id}/photos/week{week}_{slot}_{unique_id}_{clean_name}"

    upload_url = generate_signed_upload_url(gcs_path, content_type)
    return {"uploadUrl": upload_url, "gcsPath": gcs_path}


# ═══ COACH ENDPOINTS (ROLE ENFORCED) ═════════════════════════════════
@api_router.get("/coach/roster")
def get_coach_roster(user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    clients_stream = db.collection("clients").stream()
    roster = []

    for doc in clients_stream:
        c = doc.to_dict()
        c["id"] = doc.id
        # Calculate live alerts for coach
        c["alerts"] = get_client_alerts(c, c.get("coachStepsGoal", 8000))
        # Ensure traffic light is computed
        c["trafficLight"] = classify_traffic_light(c)
        roster.append(c)

    # Sort: red first, then yellow, then green; active before paused
    priority_order = {"r": 0, "am": 1, "g": 2}
    roster.sort(key=lambda x: (
        1 if x.get("status") == "paused" else 0,
        priority_order.get(x.get("trafficLight", "am"), 1),
        -x.get("daysSince", 0)
    ))

    return {"clients": roster}


@api_router.get("/coach/client/{client_id}")
def get_coach_client_deep_dive(client_id: str, user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    client_ref = db.collection("clients").document(client_id)
    client_doc = client_ref.get()

    if not client_doc.exists:
        raise HTTPException(status_code=404, detail="Client not found")

    client = client_doc.to_dict()
    client["id"] = client_id

    # Coach HAS full access to coachNote (excluding soft-deleted checkins)
    checkins_query = client_ref.collection("checkins").stream()
    checkins = []
    for c in checkins_query:
        c_dict = c.to_dict()
        if not c_dict.get("deleted", False):
            c_dict["id"] = c.id
            checkins.append(c_dict)
    checkins.sort(key=lambda c: parse_date_dmy(c.get("fullDate", "")) or date.min)

    measurements_query = client_ref.collection("measurements").stream()
    measurements = []
    for m in measurements_query:
        m_data = m.to_dict()
        m_data["id"] = m.id
        if m_data.get("photoFrontGcsPath"):
            m_data["photoFrontUrl"] = generate_signed_read_url(m_data["photoFrontGcsPath"])
        if m_data.get("photoSideGcsPath"):
            m_data["photoSideUrl"] = generate_signed_read_url(m_data["photoSideGcsPath"])
        if m_data.get("photoBackGcsPath"):
            m_data["photoBackUrl"] = generate_signed_read_url(m_data["photoBackGcsPath"])
        measurements.append(m_data)

    reports_query = client_ref.collection("reports").stream()
    reports = []
    for r in reports_query:
        r_data = r.to_dict()
        r_data["id"] = r.id
        if r_data.get("gcsPath"):
            r_data["downloadUrl"] = generate_signed_read_url(r_data["gcsPath"])
        reports.append(r_data)

    wins_query = client_ref.collection("wins").stream()
    wins = [w.to_dict() for w in wins_query]

    onboarding_doc = client_ref.collection("onboarding").document("intake").get()
    onboarding = onboarding_doc.to_dict() if onboarding_doc.exists else None

    return {
        "client": client,
        "checkins": checkins,
        "measurements": measurements,
        "wins": wins,
        "reports": reports,
        "onboarding": onboarding,
        "alerts": get_client_alerts(client, client.get("coachStepsGoal", 8000))
    }


@api_router.put("/coach/client/{client_id}/plans")
def update_client_plans(client_id: str, payload: PlanUpdatePayload, user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    client_ref = db.collection("clients").document(client_id)

    updates = {
        "plansUpdatedAt": datetime.now(timezone.utc).isoformat()
    }
    if payload.nutriPlan is not None:
        updates["nutriPlan"] = payload.nutriPlan
    if payload.workPlan is not None:
        updates["workPlan"] = payload.workPlan

    client_ref.set(updates, merge=True)
    return {"status": "ok", "updatedAt": updates["plansUpdatedAt"]}


@api_router.put("/coach/client/{client_id}/status")
def update_client_status(client_id: str, payload: StatusUpdatePayload, user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    client_ref = db.collection("clients").document(client_id)

    updates = {
        "status": payload.status,
        "pauseReason": payload.pauseReason if payload.status == "paused" else None,
        "resumeDate": payload.resumeDate if payload.status == "paused" else None,
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }
    client_ref.set(updates, merge=True)
    return {"status": "ok", "status": payload.status}


@api_router.put("/coach/client/{client_id}/notes")
def update_coach_notes(client_id: str, payload: NoteUpdatePayload, user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    client_ref = db.collection("clients").document(client_id)
    client_ref.set({"coachNote": payload.coachNote, "updatedAt": datetime.now(timezone.utc).isoformat()}, merge=True)
    return {"status": "ok"}


@api_router.delete("/coach/client/{client_id}/checkin/{checkin_id}")
def delete_client_checkin(
    client_id: str,
    checkin_id: str,
    payload: CheckinDeletePayload,
    user: AuthenticatedUser = Depends(require_coach)
):
    reason = payload.reason.strip() if payload.reason else ""
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deletion reason is required"
        )

    db = get_db()
    client_ref = db.collection("clients").document(client_id)
    client_doc = client_ref.get()
    if not client_doc.exists:
        raise HTTPException(status_code=404, detail="Client not found")

    checkin_ref = client_ref.collection("checkins").document(checkin_id)
    checkin_doc = checkin_ref.get()
    if not checkin_doc.exists:
        raise HTTPException(status_code=404, detail="Check-in document not found")

    checkin_data = checkin_doc.to_dict()
    if checkin_data.get("deleted", False):
        raise HTTPException(status_code=400, detail="Check-in is already deleted")

    # 1. Soft-delete check-in document
    deletion_timestamp = datetime.now(timezone.utc).isoformat()
    checkin_ref.set({
        "deleted": True,
        "deletedAt": deletion_timestamp,
        "deletedBy": user.email or user.uid,
        "deletedByUid": user.uid,
        "deletionReason": reason
    }, merge=True)

    # 2. Write immutable audit log entry
    audit_id = f"audit_{uuid.uuid4().hex[:12]}"
    audit_entry = {
        "id": audit_id,
        "action": "CHECKIN_SOFT_DELETED",
        "clientId": client_id,
        "checkinId": checkin_id,
        "deletedBy": user.email or user.uid,
        "deletedByUid": user.uid,
        "reason": reason,
        "timestamp": deletion_timestamp,
        "photoRetentionPolicy": "Retained in Cloud Storage for recovery; URLs suppressed from portal views.",
        "originalCheckin": checkin_data
    }
    client_ref.collection("audit_logs").document(audit_id).set(audit_entry)

    # 3. Recalculate parent client metrics from remaining active check-ins
    all_checkins_query = client_ref.collection("checkins").stream()
    active_checkins = [
        c.to_dict() for c in all_checkins_query 
        if not c.to_dict().get("deleted", False)
    ]
    def parse_sort_key(c):
        d = parse_date_dmy(c.get("fullDate", ""))
        return d if d else date.min

    active_checkins.sort(key=parse_sort_key)

    client_dict = client_doc.to_dict()
    steps_goal = client_dict.get("coachStepsGoal", 8000)
    baseline_w = client_dict.get("startW", 68.0)

    adh = calc_adherence(active_checkins, steps_goal)
    dates_list = [parse_date_dmy(c.get("fullDate", "")) for c in active_checkins if parse_date_dmy(c.get("fullDate", ""))]
    streak, days_since, checked_in = calc_streak(dates_list)

    if active_checkins:
        newest = active_checkins[-1]
        latest_w = newest.get("w", baseline_w)
        latest_meals = newest.get("meals", 5)
        latest_steps = newest.get("steps", steps_goal)
        latest_water = newest.get("water", 3.0)
        latest_stress = newest.get("st", 1)
        latest_energy = newest.get("e", 5)
    else:
        latest_w = baseline_w
        latest_meals = 0
        latest_steps = 0
        latest_water = 0.0
        latest_stress = 1
        latest_energy = 5

    tl = classify_traffic_light({
        "status": client_dict.get("status", "active"),
        "daysSince": days_since,
        "streak": streak,
        "adherence": adh
    })

    client_ref.set({
        "latestW": latest_w,
        "latestMeals": latest_meals,
        "latestSteps": latest_steps,
        "latestWater": latest_water,
        "latestStress": latest_stress,
        "latestEnergy": latest_energy,
        "daysSince": days_since,
        "checkedIn": checked_in,
        "streak": streak,
        "adherence": adh,
        "trafficLight": tl,
        "updatedAt": deletion_timestamp
    }, merge=True)

    return {
        "status": "ok",
        "deletedCheckinId": checkin_id,
        "deletionReason": reason,
        "remainingActiveCheckins": len(active_checkins),
        "adherence": adh,
        "streak": streak,
        "daysSince": days_since,
        "trafficLight": tl,
        "latestW": latest_w
    }


@api_router.post("/coach/client")
def create_client_roster_entry(payload: ClientCreatePayload, user: AuthenticatedUser = Depends(require_coach)):
    db = get_db()
    client_id = payload.name.lower().replace(" ", "_")
    client_ref = db.collection("clients").document(client_id)

    data = {
        "name": payload.name,
        "initials": payload.initials or "".join(w[0].upper() for w in payload.name.split()[:2]),
        "email": payload.email,
        "phase": payload.phase,
        "week": payload.week,
        "startDate": payload.startDate,
        "endDate": payload.endDate or "",
        "startW": payload.startW,
        "targetW": payload.targetW or payload.startW,
        "latestW": payload.startW,
        "height": payload.height,
        "city": payload.city,
        "prog": payload.prog,
        "coachStepsGoal": payload.coachStepsGoal,
        "status": "active",
        "adherence": {"meals": 100, "steps": 100, "water": 100, "vitamins": 100, "overall": 100},
        "streak": 1,
        "daysSince": 0,
        "checkedIn": False,
        "trafficLight": "g",
        "createdAt": datetime.now(timezone.utc).isoformat()
    }
    client_ref.set(data, merge=True)
    return {"status": "ok", "clientId": client_id}


# ═══ MOCK STORAGE ENDPOINTS (OFFLINE / LOCAL DEV FALLBACK) ═════════════
@api_router.put("/mock-storage/upload")
def mock_upload():
    return {"status": "uploaded"}

@api_router.get("/mock-storage/download")
def mock_download():
    return {"status": "ok", "mock": True}

# Mount router
app.include_router(api_router)
