import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import firestore as g_firestore
from api.config import settings

_firebase_app = None
_db = None

def get_db():
    global _firebase_app, _db
    if _db is None:
        if not firebase_admin._apps:
            try:
                # Uses Application Default Credentials (ADC) on Google Cloud or local gcloud auth
                _firebase_app = firebase_admin.initialize_app(options={"projectId": settings.PROJECT_ID})
            except Exception:
                _firebase_app = firebase_admin.initialize_app()
        _db = firestore.client()
    return _db
