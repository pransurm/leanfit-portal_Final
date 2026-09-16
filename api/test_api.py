import pytest
from starlette.testclient import TestClient
from api.main import app
from api.auth import AuthenticatedUser, get_current_user, require_coach
from api.config import settings

# ═══ MOCK FIRESTORE IN-MEMORY STORE ═════════════════════════════════════
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

# Fixture to initialize test store and client
@pytest.fixture
def client_with_mock_db(monkeypatch):
    mock_db = MockFirestore()

    # Preload mock clients
    mock_db.store["clients/ankit"] = {
        "name": "Ankit",
        "email": "ankit@leanfit.io",
        "phase": "Phase I",
        "week": 2,
        "coachStepsGoal": 8000,
        "coachNote": "CONFIDENTIAL: Client is recovering from knee strain. Ram only.",
        "status": "active"
    }
    mock_db.store["clients/srikanth"] = {
        "name": "Srikanth",
        "email": "srikanth@leanfit.io",
        "phase": "Phase I",
        "week": 3,
        "coachStepsGoal": 10000,
        "coachNote": "CONFIDENTIAL: High performer, ready for volume increase.",
        "status": "active"
    }

    # Patch get_db in api.main, api.database, and api.auth
    monkeypatch.setattr("api.main.get_db", lambda: mock_db)
    monkeypatch.setattr("api.database.get_db", lambda: mock_db)
    monkeypatch.setattr("api.auth.get_db", lambda: mock_db)

    # Ensure app dependency overrides are clear before test
    app.dependency_overrides = {}
    return TestClient(app), mock_db


# ═══ 1. DEMO AUTH & PRODUCTION GATING TESTS ═════════════════════════════
def test_production_auth_rejects_missing_token(client_with_mock_db, monkeypatch):
    """In production mode, any request without Authorization header is rejected with 401."""
    client, _ = client_with_mock_db
    monkeypatch.setattr(settings, "ENABLE_DEMO_AUTH", False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.get("/api/client/data")
    assert response.status_code == 401
    assert "Authentication required" in response.json()["detail"]

def test_production_auth_rejects_demo_headers(client_with_mock_db, monkeypatch):
    """In production mode, demo headers like X-Demo-User are ignored and return 401."""
    client, _ = client_with_mock_db
    monkeypatch.setattr(settings, "ENABLE_DEMO_AUTH", False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    # Attacker tries to send X-Demo-User header
    response = client.get("/api/client/data", headers={"X-Demo-User": "coach"})
    assert response.status_code == 401
    assert "Authentication required" in response.json()["detail"]

def test_production_auth_rejects_invalid_bearer(client_with_mock_db, monkeypatch):
    """In production mode, invalid Bearer tokens are rejected with 401."""
    client, _ = client_with_mock_db
    monkeypatch.setattr(settings, "ENABLE_DEMO_AUTH", False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")

    response = client.get("/api/client/data", headers={"Authorization": "Bearer fake_invalid_token"})
    assert response.status_code == 401
    assert "Invalid or expired Firebase ID token" in response.json()["detail"]


# ═══ 2. CLIENT DATA ISOLATION & ACCESS CONTROL ══════════════════════════
def test_client_only_receives_own_data(client_with_mock_db):
    """Client Ankit can only read their own document and checkins."""
    client, _ = client_with_mock_db

    # Authenticate as Ankit
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    response = client.get("/api/client/data")
    assert response.status_code == 200
    data = response.json()
    assert data["client"]["name"] == "Ankit"
    assert data["client"]["id"] == "ankit"

def test_client_cannot_access_coach_roster(client_with_mock_db):
    """Client Ankit trying to access coach roster is rejected with 403 Forbidden."""
    client, _ = client_with_mock_db

    # Authenticate as client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    response = client.get("/api/coach/roster")
    assert response.status_code == 403
    assert response.json()["detail"] == "Coach access required"

def test_client_cannot_access_coach_client_deep_dive(client_with_mock_db):
    """Client Ankit trying to access another client's file via coach endpoint gets 403."""
    client, _ = client_with_mock_db

    # Authenticate as client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    response = client.get("/api/coach/client/srikanth")
    assert response.status_code == 403
    assert response.json()["detail"] == "Coach access required"


# ═══ 3. COACHNOTE CONFIDENTIALITY & REDACTION ═══════════════════════════
def test_coach_note_never_leaks_to_client(client_with_mock_db):
    """When a client fetches their data, coachNote is strictly stripped from the response."""
    client, _ = client_with_mock_db

    # Authenticate as client Ankit
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    response = client.get("/api/client/data")
    assert response.status_code == 200
    client_payload = response.json()["client"]
    assert "coachNote" not in client_payload
    assert "CONFIDENTIAL" not in str(response.json())

def test_coach_can_read_coach_note(client_with_mock_db):
    """Coach Ram Dixit accessing client deep dive can see the private coachNote."""
    client, _ = client_with_mock_db

    # Authenticate as Coach Ram
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )

    response = client.get("/api/coach/client/ankit")
    assert response.status_code == 200
    client_payload = response.json()["client"]
    assert "coachNote" in client_payload
    assert "CONFIDENTIAL: Client is recovering from knee strain. Ram only." in client_payload["coachNote"]


# ═══ 4. CHECK-IN IDEMPOTENCY & STANDARDIZED DD-MM-YYYY ══════════════════
def test_checkin_submission_and_idempotency(client_with_mock_db):
    """Check-in creates document at standardized DD-MM-YYYY and recalculates metrics."""
    client, mock_db = client_with_mock_db

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    payload = {
        "fullDate": "08-09-2026",
        "w": 67.5,
        "steps": 8500,
        "wrk": 4,
        "meals": 5,
        "mealNote": "",
        "water": 3.0,
        "multi": True,
        "e": 8,
        "sl": 7,
        "st": 3
    }

    # First submission
    res1 = client.post("/api/client/checkin", json=payload)
    assert res1.status_code == 200
    assert res1.json()["status"] == "ok"
    assert res1.json()["checkin"]["fullDate"] == "08-09-2026"
    assert res1.json()["adherence"]["overall"] == 100

    # Verify stored in Firestore at clients/ankit/checkins/08-09-2026
    assert "clients/ankit/checkins/08-09-2026" in mock_db.store

    # Duplicate submission on same day should update idempotently
    payload["steps"] = 9000
    res2 = client.post("/api/client/checkin", json=payload)
    assert res2.status_code == 200
    assert mock_db.store["clients/ankit/checkins/08-09-2026"]["steps"] == 9000

def test_invalid_date_format_rejected(client_with_mock_db):
    """Submissions with invalid date format are rejected with 400 Bad Request."""
    client, _ = client_with_mock_db

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ankit_uid", email="ankit@leanfit.io", role="client", client_id="ankit"
    )

    bad_payload = {
        "fullDate": "invalid-date",
        "w": 67.5,
        "steps": 8000,
        "wrk": 3,
        "meals": 5,
        "water": 2.5,
        "multi": True,
        "e": 7,
        "sl": 7,
        "st": 3
    }

    res = client.post("/api/client/checkin", json=bad_payload)
    assert res.status_code == 400
    assert "Invalid date format" in res.json()["detail"]
