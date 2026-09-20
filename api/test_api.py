import pytest
from datetime import date, timedelta
from starlette.testclient import TestClient
from api.main import app
from api.auth import AuthenticatedUser, get_current_user, require_coach
from api.config import settings
from api.calculations import format_date_dmy

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
    mock_db.store["clients/client_a"] = {
        "name": "Client A",
        "email": "client_a@leanfit.io",
        "phase": "Phase I",
        "week": 2,
        "coachStepsGoal": 8000,
        "coachNote": "CONFIDENTIAL: Client is recovering from knee strain. Ram only.",
        "status": "active"
    }
    mock_db.store["clients/client_b"] = {
        "name": "Client B",
        "email": "client_b@leanfit.io",
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
    """Client can only read their own document and checkins."""
    client, _ = client_with_mock_db

    # Authenticate as Client A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
    )

    response = client.get("/api/client/data")
    assert response.status_code == 200
    data = response.json()
    assert data["client"]["name"] == "Client A"
    assert data["client"]["id"] == "client_a"

def test_client_cannot_access_coach_roster(client_with_mock_db):
    """Client trying to access coach roster is rejected with 403 Forbidden."""
    client, _ = client_with_mock_db

    # Authenticate as client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
    )

    response = client.get("/api/coach/roster")
    assert response.status_code == 403
    assert response.json()["detail"] == "Coach access required"

def test_client_cannot_access_coach_client_deep_dive(client_with_mock_db):
    """Client trying to access another client's file via coach endpoint gets 403."""
    client, _ = client_with_mock_db

    # Authenticate as client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
    )

    response = client.get("/api/coach/client/client_b")
    assert response.status_code == 403
    assert response.json()["detail"] == "Coach access required"


# ═══ 3. COACHNOTE CONFIDENTIALITY & REDACTION ═══════════════════════════
def test_coach_note_never_leaks_to_client(client_with_mock_db):
    """When a client fetches their data, coachNote is strictly stripped from the response."""
    client, _ = client_with_mock_db

    # Authenticate as client Client A
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
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

    response = client.get("/api/coach/client/client_a")
    assert response.status_code == 200
    client_payload = response.json()["client"]
    assert "coachNote" in client_payload
    assert "CONFIDENTIAL: Client is recovering from knee strain. Ram only." in client_payload["coachNote"]


# ═══ 4. CHECK-IN IDEMPOTENCY & STANDARDIZED DD-MM-YYYY ══════════════════
def test_checkin_submission_and_idempotency(client_with_mock_db):
    """Check-in creates document at standardized DD-MM-YYYY and recalculates metrics."""
    client, mock_db = client_with_mock_db

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
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

    # Verify stored in Firestore at clients/client_a/checkins/08-09-2026
    assert "clients/client_a/checkins/08-09-2026" in mock_db.store

    # Duplicate submission on same day should update idempotently
    payload["steps"] = 9000
    res2 = client.post("/api/client/checkin", json=payload)
    assert res2.status_code == 200
    assert mock_db.store["clients/client_a/checkins/08-09-2026"]["steps"] == 9000

def test_invalid_date_format_rejected(client_with_mock_db):
    """Submissions with invalid date format are rejected with 400 Bad Request."""
    client, _ = client_with_mock_db

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
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


# ═══ 5. CHECK-IN SOFT DELETION & AUDIT LOGS ══════════════════════════════
def test_client_cannot_delete_checkin(client_with_mock_db):
    """Clients attempting to call DELETE /api/coach/client/{id}/checkin/{id} are rejected with 403."""
    client, mock_db = client_with_mock_db
    mock_db.store["clients/client_a/checkins/08-09-2026"] = {"fullDate": "08-09-2026", "w": 67.5}

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
    )

    res = client.request("DELETE", "/api/coach/client/client_a/checkin/08-09-2026", json={"reason": "Wrong weight"})
    assert res.status_code == 403
    assert res.json()["detail"] == "Coach access required"

def test_coach_delete_requires_reason(client_with_mock_db):
    """Coach cannot delete a checkin without providing a non-empty reason string."""
    client, mock_db = client_with_mock_db
    mock_db.store["clients/client_a/checkins/08-09-2026"] = {"fullDate": "08-09-2026", "w": 67.5}

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )

    # Empty reason
    res = client.request("DELETE", "/api/coach/client/client_a/checkin/08-09-2026", json={"reason": "   "})
    assert res.status_code == 400
    assert "Deletion reason is required" in res.json()["detail"]

def test_coach_successful_soft_delete_and_audit_log(client_with_mock_db):
    """Coach soft deletes check-in: marks document deleted, logs to audit_logs, recalculates parent fields, and excludes from client data."""
    client, mock_db = client_with_mock_db

    # Setup Client A with 2 checkins: 01-09-2026 (68.0 kg) and 02-09-2026 (incorrect 85.0 kg)
    mock_db.store["clients/client_a/checkins/01-09-2026"] = {
        "fullDate": "01-09-2026", "w": 68.0, "meals": 5, "steps": 8000, "water": 3.0, "e": 8, "sl": 7, "st": 3
    }
    mock_db.store["clients/client_a/checkins/02-09-2026"] = {
        "fullDate": "02-09-2026", "w": 85.0, "meals": 5, "steps": 8000, "water": 3.0, "e": 8, "sl": 7, "st": 3
    }
    mock_db.store["clients/client_a"]["latestW"] = 85.0

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )

    delete_reason = "Client scale malfunction recorded 85kg instead of 67.8kg"
    res = client.request(
        "DELETE",
        "/api/coach/client/client_a/checkin/02-09-2026",
        json={"reason": delete_reason}
    )
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["status"] == "ok"
    assert res_data["deletedCheckinId"] == "02-09-2026"
    assert res_data["deletionReason"] == delete_reason
    assert res_data["remainingActiveCheckins"] == 1
    assert res_data["latestW"] == 68.0

    # 1. Verify checkin is marked deleted in store, NOT purged (soft delete)
    checkin_in_db = mock_db.store["clients/client_a/checkins/02-09-2026"]
    assert checkin_in_db["deleted"] is True
    assert checkin_in_db["deletedBy"] == "ram@leanfit.io"
    assert checkin_in_db["deletionReason"] == delete_reason
    assert "deletedAt" in checkin_in_db

    # 2. Verify audit log was created under clients/client_a/audit_logs/
    audit_logs = [v for k, v in mock_db.store.items() if k.startswith("clients/client_a/audit_logs/")]
    assert len(audit_logs) == 1
    log = audit_logs[0]
    assert log["action"] == "CHECKIN_SOFT_DELETED"
    assert log["checkinId"] == "02-09-2026"
    assert log["deletedBy"] == "ram@leanfit.io"
    assert log["reason"] == delete_reason
    assert "photoRetentionPolicy" in log

    # 3. Verify parent client document latestW recomputed to remaining active checkin (68.0 kg)
    assert mock_db.store["clients/client_a"]["latestW"] == 68.0

    # 4. Verify client calling GET /api/client/data does NOT see deleted checkin
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="client_a@leanfit.io", role="client", client_id="client_a"
    )
    client_res = client.get("/api/client/data")
    assert client_res.status_code == 200
    returned_checkins = client_res.json()["checkins"]
    assert len(returned_checkins) == 1
    assert returned_checkins[0]["fullDate"] == "01-09-2026"

def test_mid_sequence_deletion_breaks_streak(client_with_mock_db):
    """When a mid-sequence check-in is deleted, streak must break rather than counting remaining docs."""
    client, mock_db = client_with_mock_db

    t0 = date.today()
    t1 = t0 - timedelta(days=1)
    t2 = t0 - timedelta(days=2)

    d0 = format_date_dmy(t0)
    d1 = format_date_dmy(t1)
    d2 = format_date_dmy(t2)

    # 3 consecutive days: t2, t1, t0
    for d in [d0, d1, d2]:
        mock_db.store[f"clients/client_a/checkins/{d}"] = {
            "fullDate": d, "w": 68.0, "meals": 5, "steps": 8000, "water": 3.0, "e": 8, "sl": 7, "st": 3
        }

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )

    # Delete the middle check-in d1 (yesterday)
    res = client.request(
        "DELETE",
        f"/api/coach/client/client_a/checkin/{d1}",
        json={"reason": "Incorrect data entered for yesterday"}
    )
    assert res.status_code == 200
    res_data = res.json()

    # Remaining active docs: d0 (today) and d2 (2 days ago). Total remaining = 2.
    assert res_data["remainingActiveCheckins"] == 2
    # Because d1 is deleted, the streak from today encounters a gap at yesterday, so streak MUST be 1, NOT 2!
    assert res_data["streak"] == 1
    assert mock_db.store["clients/client_a"]["streak"] == 1


def test_checkin_with_photos(client_with_mock_db):
    """Clients can submit photos with check-in and coach deep dive retrieves them."""
    client, mock_db = client_with_mock_db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="alice@example.com", role="client", client_id="client_a"
    )
    mock_db.store["clients/client_a"] = {"name": "Alice"}

    payload = {
        "fullDate": "15-09-2026",
        "date": "15/9",
        "w": 68.0,
        "steps": 10000,
        "wrk": 3,
        "meals": 4,
        "mealNote": "",
        "water": 3.0,
        "multi": True,
        "e": 8,
        "sl": 7,
        "st": 3,
        "note": "Uploaded bi-weekly photos",
        "photos": {
            "Front": "data:image/jpeg;base64,mockFrontPhoto",
            "Side": "data:image/jpeg;base64,mockSidePhoto",
            "Back": None
        }
    }
    res = client.post("/api/client/checkin", json=payload)
    assert res.status_code == 200

    # Verify stored in db
    stored = mock_db.store["clients/client_a/checkins/15-09-2026"]
    assert stored["photos"]["Front"] == "data:image/jpeg;base64,mockFrontPhoto"
    assert stored["photos"]["Side"] == "data:image/jpeg;base64,mockSidePhoto"

    # Now verify coach deep dive retrieves it
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )
    res_coach = client.get("/api/coach/client/client_a")
    assert res_coach.status_code == 200
    coach_checkins = res_coach.json()["checkins"]
    assert len(coach_checkins) >= 1
    found = [c for c in coach_checkins if c.get("fullDate") == "15-09-2026"][0]
    assert found["photos"]["Front"] == "data:image/jpeg;base64,mockFrontPhoto"


def test_coach_feedback_visibility(client_with_mock_db):
    """Coach feedback is visible to the client, while coachNote remains private."""
    client, mock_db = client_with_mock_db
    mock_db.store["clients/client_a"] = {
        "name": "Alice",
        "coachNote": "PRIVATE: Internal note",
        "coachFeedback": "Keep pushing, Alice!"
    }

    # As client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="alice@example.com", role="client", client_id="client_a"
    )
    res = client.get("/api/client/data")
    assert res.status_code == 200
    client_data = res.json()["client"]
    assert "coachNote" not in client_data
    assert client_data.get("coachFeedback") == "Keep pushing, Alice!"

    # As coach: update notes and feedback
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )
    update_res = client.put("/api/coach/client/client_a/notes", json={
        "coachNote": "Updated private note",
        "coachFeedback": "Increase protein to 140g this week!"
    })
    assert update_res.status_code == 200

    # Re-verify as client
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="client_a_uid", email="alice@example.com", role="client", client_id="client_a"
    )
    res2 = client.get("/api/client/data")
    client_data2 = res2.json()["client"]
    assert "coachNote" not in client_data2
    assert client_data2.get("coachFeedback") == "Increase protein to 140g this week!"


def test_deep_dive_resolves_all_photo_sources(client_with_mock_db):
    """Coach deep dive resolves photos from checkins, measurements, and onboarding."""
    client, mock_db = client_with_mock_db

    # 1. Check-in with photos
    mock_db.store["clients/client_a/checkins/18-09-2026"] = {
        "fullDate": "18-09-2026",
        "w": 66.8,
        "photos": {
            "Front": "data:image/jpeg;base64,chkFront",
            "Side": "data:image/jpeg;base64,chkSide"
        }
    }

    # 2. Measurement with photos
    mock_db.store["clients/client_a/measurements/week_1"] = {
        "week": 1,
        "date": "10-09-2026",
        "weight": 67.2,
        "photoFrontGcsPath": "data:image/jpeg;base64,measFront"
    }

    # 3. Onboarding with photos
    mock_db.store["clients/client_a/onboarding/intake"] = {
        "photoFront": "data:image/jpeg;base64,onboardFront",
        "photoSide": "data:image/jpeg;base64,onboardSide",
        "weight": 68.0,
        "submittedAt": "01-09-2026"
    }

    # As coach Ram
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        uid="ram_uid", email="ram@leanfit.io", role="coach", client_id="coach_ram"
    )

    res = client.get("/api/coach/client/client_a")
    assert res.status_code == 200
    data = res.json()

    # Verify checkin photos
    chk = [c for c in data["checkins"] if c.get("fullDate") == "18-09-2026"][0]
    assert chk["photos"]["Front"] == "data:image/jpeg;base64,chkFront"

    # Verify measurement photos
    meas = [m for m in data["measurements"] if m.get("week") == 1][0]
    assert meas["photoFrontUrl"] == "data:image/jpeg;base64,measFront"

    # Verify onboarding photos
    assert data["onboarding"]["photoFront"] == "data:image/jpeg;base64,onboardFront"
    assert data["onboarding"]["photoSide"] == "data:image/jpeg;base64,onboardSide"



