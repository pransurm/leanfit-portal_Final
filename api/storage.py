import datetime
from typing import Optional
from api.config import settings

_storage_client = None

def get_storage_client():
    global _storage_client
    if _storage_client is None:
        try:
            from google.cloud import storage
            _storage_client = storage.Client(project=settings.PROJECT_ID)
        except Exception:
            _storage_client = None
    return _storage_client

def generate_signed_upload_url(gcs_path: str, content_type: str = "application/octet-stream") -> str:
    """Generate a V4 signed PUT URL for uploading client assets."""
    client = get_storage_client()
    if client:
        try:
            bucket = client.bucket(settings.GCS_BUCKET)
            blob = bucket.blob(gcs_path)
            return blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=settings.SIGNED_URL_EXPIRATION_MINUTES),
                method="PUT",
                content_type=content_type
            )
        except Exception:
            pass
    # Fallback for local emulator or offline testing
    return f"http://localhost:8080/api/mock-storage/upload?path={gcs_path}"

def generate_signed_read_url(gcs_path: str) -> str:
    """Generate a V4 signed GET URL with a 15-minute TTL for viewing private files."""
    if not gcs_path:
        return ""
    # If path is already a full URL, return as-is
    if gcs_path.startswith("http://") or gcs_path.startswith("https://"):
        return gcs_path

    client = get_storage_client()
    if client:
        try:
            bucket = client.bucket(settings.GCS_BUCKET)
            blob = bucket.blob(gcs_path)
            return blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=settings.SIGNED_URL_EXPIRATION_MINUTES),
                method="GET"
            )
        except Exception:
            pass
    return f"http://localhost:8080/api/mock-storage/download?path={gcs_path}"
