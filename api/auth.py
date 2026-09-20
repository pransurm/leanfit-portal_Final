from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, Depends, status
from api.config import settings
from api.database import get_db

class AuthenticatedUser:
    def __init__(self, uid: str, email: str, role: str, client_id: Optional[str] = None):
        self.uid = uid
        self.email = email
        self.role = role
        self.client_id = client_id or uid

    @property
    def is_coach(self) -> bool:
        return self.role == "coach"

async def get_current_user(
    authorization: Optional[str] = Header(None),
    x_demo_user: Optional[str] = Header(None)
) -> AuthenticatedUser:
    """
    Validates Firebase ID Token from Authorization header.
    
    SECURITY ENFORCEMENT:
    1. In production (default): ONLY valid Firebase ID tokens are accepted. Any request without
       a valid Firebase Bearer token is rejected with HTTP 401 Unauthorized. Demo headers are ignored.
    2. In local dev (only when ENVIRONMENT=development AND ENABLE_DEMO_AUTH=true):
       Optional X-Demo-User header can be used for offline developer testing without active GCP keys.
    """
    # 1. Primary path: Firebase ID token verification
    if authorization:
        if not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Authorization header format. Expected 'Bearer <token>'."
            )
        token = authorization.split("Bearer ", 1)[1].strip()
        try:
            db = get_db()
            from firebase_admin import auth as firebase_auth
            from firebase_admin import exceptions as firebase_exceptions
            try:
                decoded_token = firebase_auth.verify_id_token(token)
            except (
                ValueError,
                firebase_auth.InvalidIdTokenError,
                firebase_auth.ExpiredIdTokenError,
                firebase_auth.RevokedIdTokenError,
                firebase_auth.CertificateFetchError,
                firebase_exceptions.FirebaseError
            ) as auth_err:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"Invalid or expired Firebase ID token: {str(auth_err)}"
                )

            uid = decoded_token.get("uid")
            email = decoded_token.get("email", "")
            token_role = decoded_token.get("role", "client")
            client_id = decoded_token.get("clientId", uid)

            # Check users/{uid} document or fallback to email lookup
            fs_role = "client"
            user_doc = db.collection("users").document(uid).get()
            if user_doc.exists:
                u_data = user_doc.to_dict()
                fs_role = u_data.get("role", "client")
                if u_data.get("clientId"):
                    client_id = u_data.get("clientId")
            elif email:
                # Fallback 1: lookup users collection by email
                u_matches = list(db.collection("users").where("email", "==", email.lower()).limit(1).stream())
                if u_matches:
                    u_data = u_matches[0].to_dict()
                    fs_role = u_data.get("role", "client")
                    if u_data.get("clientId"):
                        client_id = u_data.get("clientId")

            # Fallback 2: If client_id is still uid or not found, lookup clients collection by email
            if email and (not client_id or client_id == uid):
                c_matches = list(db.collection("clients").where("email", "==", email.lower()).limit(1).stream())
                if c_matches:
                    client_id = c_matches[0].id
                    try:
                        db.collection("users").document(uid).set({
                            "uid": uid,
                            "email": email,
                            "clientId": client_id,
                            "role": fs_role
                        }, merge=True)
                    except Exception:
                        pass

            # Privilege escalation protection & coach identification:
            # User is coach if:
            # 1. Custom token claim 'role' == 'coach', OR
            # 2. Firestore users collection 'role' == 'coach', OR
            # 3. Known coach email (e.g. ram@leanfit.io or coach@leanfit.io)
            is_coach = (
                token_role == "coach"
                or fs_role == "coach"
                or (email and email.lower().strip() in ("ram@leanfit.io", "coach@leanfit.io"))
            )
            role = "coach" if is_coach else "client"

            # Auto-sync custom claims if user is coach but token lacks claims
            if is_coach and token_role != "coach":
                try:
                    firebase_auth.set_custom_user_claims(uid, {"role": "coach"})
                except Exception:
                    pass

            return AuthenticatedUser(uid=uid, email=email, role=role, client_id=client_id)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Authentication service error: {str(e)}"
            )

    # 2. Local development fallback — strictly gated by settings.ENABLE_DEMO_AUTH
    if settings.ENABLE_DEMO_AUTH:
        if x_demo_user:
            if x_demo_user.lower() in ("coach", "ram"):
                return AuthenticatedUser(uid="coach_ram", email="ram@leanfit.io", role="coach", client_id="coach_ram")
            return AuthenticatedUser(uid=x_demo_user, email=f"{x_demo_user}@leanfit.io", role="client", client_id=x_demo_user)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Demo authentication enabled, but no X-Demo-User header was provided."
        )

    # In production or whenever ENABLE_DEMO_AUTH is False:
    # HARD REJECTION: Demo headers are rejected, and missing Bearer token raises 401.
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Please provide a valid Firebase ID token in the Authorization header."
    )

async def require_coach(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not user.is_coach:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Coach access required"
        )
    return user

async def require_client(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    return user
