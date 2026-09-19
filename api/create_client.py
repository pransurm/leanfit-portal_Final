"""Script to create a backend user and client profile in Firestore & Firebase Auth."""
import sys
import os
import secrets
import string
from datetime import datetime, timezone

# Ensure project root in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except Exception:
    pass

from api.database import get_db

def generate_tough_password(length=14):
    """Generates a cryptographically strong, tough password."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
    # Ensure at least 2 uppercase, 2 lowercase, 2 digits, 2 symbols
    password = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*()-_=+"),
        secrets.choice("!@#$%^&*()-_=+"),
    ]
    password += [secrets.choice(alphabet) for _ in range(length - len(password))]
    secrets.SystemRandom().shuffle(password)
    return "".join(password)

def create_adesh():
    db = get_db()
    name = "Adesh"
    email = "adesh@leanfit.io"
    client_id = "adesh"
    start_w = 94.0
    start_w_lbs = round(start_w * 2.20462, 1)
    tough_password = generate_tough_password(14)

    print(f"Creating backend user and client record for {name} ({email})...")

    # 1. Firebase Auth user creation (with timeout in case ADC is offline)
    uid = client_id
    import threading
    def try_firebase_auth():
        nonlocal uid
        try:
            from firebase_admin import auth as firebase_auth
            user = None
            try:
                user = firebase_auth.get_user_by_email(email)
                print(f"  [INFO] User already exists in Firebase Auth with UID: {user.uid}")
                uid = user.uid
                firebase_auth.update_user(uid, password=tough_password)
                print(f"  [OK] Updated password to tough password for {email}")
            except Exception:
                pass

            if user is None:
                try:
                    user = firebase_auth.create_user(
                        email=email,
                        password=tough_password,
                        display_name=name
                    )
                    uid = user.uid
                    print(f"  [OK] Created user in Firebase Auth with UID: {uid}")
                except Exception as e:
                    print(f"  [WARN] Notice on Firebase Auth user creation: {e}")

            try:
                firebase_auth.set_custom_user_claims(uid, {"role": "client", "clientId": client_id})
                print(f"  [OK] Set custom claims for {uid}: role=client, clientId={client_id}")
            except Exception as e:
                print(f"  [WARN] Notice on custom claims: {e}")
        except Exception as e:
            print(f"  [WARN] Firebase Admin Auth notice: {e}")

    t = threading.Thread(target=try_firebase_auth, daemon=True)
    t.start()
    t.join(timeout=3.0)
    if t.is_alive():
        print("  [INFO] Firebase Auth remote API call timed out (offline/local mode). Proceeding with Firestore user record.")

    # 2. Firestore: users collection
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
        print(f"  [OK] Created Firestore document users/{uid}")
    except Exception as e:
        print(f"  [WARN] Firestore users doc notice: {e}")

    # 3. Firestore: clients collection
    try:
        client_ref = db.collection("clients").document(client_id)
        client_data = {
            "name": name,
            "initials": "AD",
            "email": email,
            "phase": "Phase I",
            "week": 1,
            "startDate": datetime.now(timezone.utc).strftime("%d-%m-%Y"),
            "startW": start_w,
            "startWLbs": start_w_lbs,
            "targetW": 85.0,
            "latestW": start_w,
            "height": 178.0,
            "heightInches": 70.1,
            "city": "Mumbai",
            "prog": "LeanFit 6-Month Transformation",
            "coachStepsGoal": 8000,
            "weightUnit": "kg",
            "measUnit": "cm",
            "status": "active",
            "trafficLight": "g",
            "adherence": {"meals": 100, "steps": 100, "water": 100, "vitamins": 100, "overall": 100},
            "streak": 1,
            "daysSince": 0,
            "checkedIn": False,
            "coachNote": "Initial baseline weight 94 kg. Goal: Fat loss & recomposition.",
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        client_ref.set(client_data, merge=True)
        print(f"  [OK] Created Firestore document clients/{client_id} with weight={start_w} kg ({start_w_lbs} lbs)")

        # Baseline measurement record
        client_ref.collection("measurements").document("baseline").set({
            "week": 0,
            "date": datetime.now(timezone.utc).strftime("%d-%m-%Y"),
            "weight": start_w,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
        print(f"  [OK] Created baseline measurement for {client_id}")

        # Coach notification
        notif_ref = db.collection("coach_notifications").document(f"notif_{client_id}")
        notif_ref.set({
            "id": f"notif_{client_id}",
            "type": "NEW_CLIENT_ADDED",
            "title": "New Client Added: Adesh",
            "body": f"Adesh has been added with starting weight 94 kg.",
            "clientId": client_id,
            "read": False,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
        print(f"  [OK] Created Coach notification for Adesh")

    except Exception as e:
        print(f"  [WARN] Firestore clients doc notice: {e}")

    print("\n" + "="*50)
    print("ADESH USER CREATION SUMMARY")
    print("="*50)
    print(f"  Name:     {name}")
    print(f"  Email/ID: {email}")
    print(f"  Password: {tough_password}")
    print(f"  Weight:   {start_w} kg ({start_w_lbs} lbs)")
    print(f"  Status:   Active")
    print("="*50)
    return {"name": name, "email": email, "password": tough_password, "weight": start_w}

if __name__ == "__main__":
    create_adesh()
