import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_ID: str = os.getenv("GCP_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCLOUD_PROJECT") or "project-2875a590-5860-4bb6-a46"
    GCS_BUCKET: str = os.getenv("GCS_BUCKET") or f"{PROJECT_ID}.appspot.com"
    FIRESTORE_DATABASE: str = os.getenv("FIRESTORE_DATABASE", "(default)")
    SIGNED_URL_EXPIRATION_MINUTES: int = int(os.getenv("SIGNED_URL_EXPIRATION_MINUTES", "15"))
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "production")

    # HARD SECURITY GATE: Demo auth can ONLY ever be True if ENVIRONMENT is explicitly "development"
    # AND ENABLE_DEMO_AUTH is explicitly set to "true". In production, this evaluates to False unconditionally.
    ENABLE_DEMO_AUTH: bool = (
        os.getenv("ENVIRONMENT", "production").lower() == "development" and
        os.getenv("ENABLE_DEMO_AUTH", "false").lower() == "true"
    )

    _base_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]
    if os.getenv("FRONTEND_URL"):
        _base_origins.append(os.getenv("FRONTEND_URL").strip())
    if os.getenv("ALLOWED_ORIGINS"):
        _base_origins.extend([o.strip() for o in os.getenv("ALLOWED_ORIGINS").split(",") if o.strip()])
    CORS_ORIGINS: list[str] = list(dict.fromkeys(_base_origins))

settings = Settings()
