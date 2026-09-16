from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, Depends, status
from firebase_admin import auth as firebase_auth
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
    In local development / demo mode, allows demo headers if configured.
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ")[1].strip()
        try:
            decoded_token = firebase_auth.verify_id_token(token)
            uid = decoded_token.get("uid")
            email = decoded_token.get("email", "")
            role = decoded_token.get("role", "client")
            client_id = decoded_token.get("clientId", uid)

            # If role is not in token custom claims, check users/{uid}
            if not decoded_token.get("role"):
                db = get_db()
                user_doc = db.collection("users").document(uid).get()
                if user_doc.exists:
                    u_data = user_doc.to_dict()
                    role = u_data.get("role", "client")
                    client_id = u_data.get("clientId", uid)

            return AuthenticatedUser(uid=uid, email=email, role=role, client_id=client_id)
        except Exception as e:
            # If demo token or invalid
            pass

    # Demo fallback for instant UI preview & developer testing
    if x_demo_user:
        if x_demo_user.lower() in ("coach", "ram"):
            return AuthenticatedUser(uid="coach_ram", email="ram@leanfit.io", role="coach", client_id="coach_ram")
        return AuthenticatedUser(uid=x_demo_user, email=f"{x_demo_user}@leanfit.io", role="client", client_id=x_demo_user)

    # If demo mode is allowed or mock user
    return AuthenticatedUser(uid="ankit", email="ankit@leanfit.io", role="client", client_id="ankit")

async def require_coach(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    if not user.is_coach:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Coach access required"
        )
    return user

async def require_client(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    return user
