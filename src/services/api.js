import { getCurrentToken } from "../firebase";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

let activeDemoUser = null;

export function setDemoUser(userOrRole) {
  if (import.meta.env.DEV) {
    activeDemoUser = userOrRole;
  }
}

export function getDemoUser() {
  return import.meta.env.DEV ? activeDemoUser : null;
}

async function request(endpoint, options = {}) {
  const token = await getCurrentToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (import.meta.env.DEV && activeDemoUser) {
    headers["X-Demo-User"] = activeDemoUser;
  }

  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const resp = await fetch(url, {
    ...options,
    headers
  });

  if (!resp.ok) {
    let errDetail = resp.statusText;
    try {
      const errJson = await resp.json();
      errDetail = errJson.detail || errJson.message || resp.statusText;
    } catch (_) {}
    throw new Error(errDetail || `Request failed with status ${resp.status}`);
  }

  return await resp.json();
}

export async function fetchMe() {
  return request("/me");
}

export async function fetchClientData() {
  return request("/client/data");
}

export async function submitCheckIn(payload) {
  return request("/client/checkin", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitMeasurement(payload) {
  return request("/client/measurement", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitWin(payload) {
  return request("/client/wins", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function submitOnboarding(payload) {
  return request("/client/onboarding", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function registerOnboarding(payload) {
  return request("/public/onboarding/complete", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getReportUploadUrl(fileName, contentType = "application/pdf") {
  return request("/client/reports/upload-url", {
    method: "POST",
    body: JSON.stringify({ fileName, contentType })
  });
}

export async function confirmReportUpload(reportData) {
  return request("/client/reports/confirm", {
    method: "POST",
    body: JSON.stringify(reportData)
  });
}

export async function getPhotoUploadUrl(fileName, slot, week, contentType = "image/jpeg") {
  return request("/client/photos/upload-url", {
    method: "POST",
    body: JSON.stringify({ fileName, slot, week, contentType })
  });
}

export async function uploadFileToSignedUrl(signedUrl, file, contentType) {
  const resp = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || file.type || "application/octet-stream"
    },
    body: file
  });
  if (!resp.ok) {
    throw new Error(`Cloud Storage upload failed: ${resp.statusText}`);
  }
  return true;
}

export async function fetchCoachRoster() {
  return request("/coach/roster");
}

export async function fetchCoachClientDeepDive(clientId) {
  return request(`/coach/client/${clientId}`);
}

export async function updateCoachPlans(clientId, { nutriPlan, workPlan }) {
  return request(`/coach/client/${clientId}/plans`, {
    method: "PUT",
    body: JSON.stringify({ nutriPlan, workPlan })
  });
}

export async function updateCoachStatus(clientId, { status, pauseReason, resumeDate }) {
  return request(`/coach/client/${clientId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status, pauseReason, resumeDate })
  });
}

export async function updateCoachNotes(clientId, notesData) {
  const payload = typeof notesData === "string" ? { coachNote: notesData } : notesData;
  return request(`/coach/client/${clientId}/notes`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteCoachClientCheckin(clientId, checkinId, reason) {
  return request(`/coach/client/${clientId}/checkin/${checkinId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason })
  });
}
