import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_ID: str = os.getenv("GCP_PROJECT", os.getenv("GOOGLE_CLOUD_PROJECT", "leanfit-portal"))
    GCS_BUCKET: str = os.getenv("GCS_BUCKET", f"{PROJECT_ID}.appspot.com")
    FIRESTORE_DATABASE: str = os.getenv("FIRESTORE_DATABASE", "(default)")
    SIGNED_URL_EXPIRATION_MINUTES: int = int(os.getenv("SIGNED_URL_EXPIRATION_MINUTES", "15"))
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "production")

    # HARD SECURITY GATE: Demo auth can ONLY ever be True if ENVIRONMENT is explicitly "development"
    # AND ENABLE_DEMO_AUTH is explicitly set to "true". In production, this evaluates to False unconditionally.
    ENABLE_DEMO_AUTH: bool = (
        os.getenv("ENVIRONMENT", "production").lower() == "development" and
        os.getenv("ENABLE_DEMO_AUTH", "false").lower() == "true"
    )

    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

settings = Settings()
