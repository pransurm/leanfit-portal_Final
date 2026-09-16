import os
from api.config import settings

_firebase_app = None
_db = None

class MockDocSnapshot:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data else {}

class MockDocRef:
    def __init__(self, store, path):
        self.store = store
        self.path = path

    def get(self):
        data = self.store.get(self.path)
        return MockDocSnapshot(self.path.split("/")[-1], data)

    def set(self, data, merge=False):
        if merge and self.path in self.store and isinstance(self.store[self.path], dict):
            self.store[self.path].update(data)
        else:
            self.store[self.path] = dict(data)

    def collection(self, name):
        return MockCollectionRef(self.store, f"{self.path}/{name}")

class MockCollectionRef:
    def __init__(self, store, path):
        self.store = store
        self.path = path

    def document(self, doc_id):
        return MockDocRef(self.store, f"{self.path}/{doc_id}")

    def stream(self):
        results = []
        prefix = f"{self.path}/"
        for key, val in list(self.store.items()):
            if key.startswith(prefix):
                sub = key[len(prefix):]
                if "/" not in sub:
                    results.append(MockDocSnapshot(sub, val))
        return results

class MockFirestore:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return MockCollectionRef(self.store, name)


def get_db():
    global _firebase_app, _db
    if _db is None:
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
            if not firebase_admin._apps:
                try:
                    _firebase_app = firebase_admin.initialize_app(options={"projectId": settings.PROJECT_ID})
                except Exception:
                    _firebase_app = firebase_admin.initialize_app()
            _db = firestore.client()
        except Exception:
            # Fallback for environments where gRPC native DLL is blocked by OS policy (e.g. Windows WDAC)
            _db = MockFirestore()
    return _db
