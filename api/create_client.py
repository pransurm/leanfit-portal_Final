"""Script to create or update client accounts in Firestore & Firebase Auth."""
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

def generate_tough_password(length: int = 14) -> str:
    """Generate a cryptographically secure random password with mixed charsets."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        password = ''.join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in password)
                and any(c.isupper() for c in password)
                and any(c.isdigit() for c in password)
                and any(c in "!@#$%^&*" for c in password)):
            return password

def create_or_update_client(
    name: str,
    email: str,
    password: str,
    start_w: float = 70.0,
    height: float = 175.0,
    city: str = "Mumbai",
    prog: str = "LeanFit 6-Month Transformation",
    client_id: str = None
):
    db = get_db()
    clean_name = "".join(c for c in name.lower() if c.isalnum())
    if not client_id:
        client_id = clean_name or "client"
    start_w_lbs = round(start_w * 2.20462, 1)

    print(f"\nProvisioning account for {name} ({email})...")

    # 1. Firebase Auth user creation or password update
    uid = client_id
    try:
        from firebase_admin import auth as firebase_auth
        user = None
        try:
            user = firebase_auth.get_user_by_email(email)
            uid = user.uid
            firebase_auth.update_user(uid, password=password, display_name=name)
            print(f"  [OK] Found existing Firebase Auth user ({uid}). Updated password and display name.")
        except Exception:
            pass

        if user is None:
            try:
                user = firebase_auth.create_user(
                    email=email,
                    password=password,
                    display_name=name
                )
                uid = user.uid
                print(f"  [OK] Created new user in Firebase Auth with UID: {uid}")
            except Exception as e:
                print(f"  [WARN] Firebase Auth create_user error: {e}")

        try:
            firebase_auth.set_custom_user_claims(uid, {"role": "client", "clientId": client_id})
            print(f"  [OK] Set custom claims for {uid}: role=client, clientId={client_id}")
        except Exception as e:
            print(f"  [WARN] Custom claims notice: {e}")
    except Exception as e:
        print(f"  [WARN] Firebase Admin Auth error: {e}")

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
        print(f"  [OK] Synced Firestore document users/{uid}")
    except Exception as e:
        print(f"  [WARN] Firestore users doc notice: {e}")

    # 3. Firestore: clients collection
    try:
        client_ref = db.collection("clients").document(client_id)
        client_data = {
            "name": name,
            "initials": "".join([p[0].upper() for p in name.split()[:2]]) or "LF",
            "email": email,
            "phase": "Phase I",
            "week": 1,
            "startDate": datetime.now(timezone.utc).strftime("%d-%m-%Y"),
            "startW": start_w,
            "startWLbs": start_w_lbs,
            "targetW": round(start_w - 8.0, 1),
            "latestW": start_w,
            "height": height,
            "heightInches": round(height / 2.54, 1),
            "city": city,
            "prog": prog,
            "coachStepsGoal": 8000,
            "weightUnit": "kg",
            "measUnit": "cm",
            "status": "active",
            "trafficLight": "g",
            "adherence": {"meals": 100, "steps": 100, "water": 100, "vitamins": 100, "overall": 100},
            "streak": 1,
            "daysSince": 0,
            "checkedIn": False,
            "coachNote": f"Initial baseline weight {start_w} kg. Goal: Fat loss & recomposition.",
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        client_ref.set(client_data, merge=True)
        print(f"  [OK] Synced Firestore document clients/{client_id}")

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
            "title": f"New Client Added: {name}",
            "body": f"{name} has been added with starting weight {start_w} kg.",
            "clientId": client_id,
            "read": False,
            "createdAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
        print(f"  [OK] Created Coach notification for {name}")

    except Exception as e:
        print(f"  [WARN] Firestore clients doc notice: {e}")

    print("=" * 50)
    print(f"CLIENT CREDENTIALS READY")
    print("=" * 50)
    print(f"  Name:     {name}")
    print(f"  Email:    {email}")
    print(f"  Password: {password}")
    print(f"  Status:   Active")
    print("=" * 50)
    return {"name": name, "email": email, "password": password}


if __name__ == "__main__":
    # Check if CLI args provided: python3 api/create_client.py <email> <password> [name]
    if len(sys.argv) >= 3:
        cli_email = sys.argv[1].strip()
        cli_password = sys.argv[2].strip()
        cli_name = sys.argv[3].strip() if len(sys.argv) > 3 else cli_email.split("@")[0].capitalize()
        create_or_update_client(name=cli_name, email=cli_email, password=cli_password)
    else:
        print("Usage: python3 api/create_client.py <email> <password> [name]")
        print("Example: python3 api/create_client.py client@example.com MyPass123 'Jane Doe'")
