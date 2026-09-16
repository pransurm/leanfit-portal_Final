"""Admin CLI script to promote a user to Coach role by setting Firebase Custom User Claims."""
import sys
import os
import argparse
from datetime import datetime, timezone

# Ensure project root in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.database import get_db

def set_coach_role(identifier: str, revoke: bool = False):
    """
    Sets custom user claims {'role': 'coach'} or revokes to {'role': 'client'}
    and updates Firestore users/{uid} document.
    identifier: either user email or Firebase Auth UID.
    """
    try:
        from firebase_admin import auth as firebase_auth
    except ImportError:
        print("❌ Error: firebase_admin module is required to set custom claims.")
        sys.exit(1)

    db = get_db()
    user = None

    # Try lookup by email first, then by UID
    if "@" in identifier:
        try:
            user = firebase_auth.get_user_by_email(identifier)
        except Exception:
            pass

    if user is None:
        try:
            user = firebase_auth.get_user(identifier)
        except Exception as e:
            print(f"❌ User '{identifier}' not found in Firebase Auth: {e}")
            sys.exit(1)

    target_role = "client" if revoke else "coach"
    new_claims = {"role": target_role}

    # 1. Set Custom User Claims on Firebase Auth token
    try:
        firebase_auth.set_custom_user_claims(user.uid, new_claims)
        print(f"✅ Firebase custom claims set for user '{user.email or user.uid}': {new_claims}")
    except Exception as e:
        print(f"❌ Failed to set custom claims: {e}")
        sys.exit(1)

    # 2. Update users/{uid} in Firestore
    try:
        user_ref = db.collection("users").document(user.uid)
        user_ref.set({
            "uid": user.uid,
            "email": user.email,
            "role": target_role,
            "updatedAt": datetime.now(timezone.utc).isoformat()
        }, merge=True)
        print(f"✅ Firestore 'users/{user.uid}' record updated with role: '{target_role}'")
    except Exception as e:
        print(f"⚠️ Notice: Could not update Firestore users doc: {e}")

    print("\n👉 IMPORTANT: The user's current session token will carry this new claim")
    print("   as soon as the frontend calls getIdToken(true) to force a token refresh.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Promote or demote a LeanFit user to Coach role.")
    parser.add_argument("identifier", help="User email or Firebase UID (e.g. ram@leanfit.io)")
    parser.add_argument("--revoke", action="store_true", help="Revoke coach role and set to client")
    args = parser.parse_args()

    set_coach_role(args.identifier, revoke=args.revoke)
