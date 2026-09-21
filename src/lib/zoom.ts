import type { Bindings } from "../env";

const ZOOM_API_BASE = "https://api.zoom.us/v2";
const TOKEN_CACHE_KEY = "zoom:access_token";

type ZoomTokenResponse = {
  access_token: string;
  expires_in: number;
};

async function fetchNewAccessToken(env: Bindings): Promise<ZoomTokenResponse> {
  const basicAuth = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basicAuth}` },
    }
  );
  if (!res.ok) {
    throw new Error(`Zoom OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getAccessToken(env: Bindings): Promise<string> {
  const cached = await env.CACHE_KV.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const token = await fetchNewAccessToken(env);
  // Cache slightly under the real expiry (usually 3600s) to avoid using a stale token.
  await env.CACHE_KV.put(TOKEN_CACHE_KEY, token.access_token, { expirationTtl: Math.max(60, token.expires_in - 120) });
  return token.access_token;
}

async function zoomFetch(env: Bindings, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken(env);
  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function zoomJson<T>(env: Bindings, path: string, init: RequestInit = {}): Promise<T> {
  const res = await zoomFetch(env, path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zoom API ${init.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : ({} as T);
}

export type ZoomEventType = "meeting" | "webinar";

export type ZoomCreatePayload = {
  topic: string;
  agenda?: string;
  duration: number; // minutes
  start_time: string; // ISO 8601 UTC, e.g. "2026-01-14T19:00:00Z"
  timezone?: string; // IANA tz Zoom should display the time in; storage is always UTC
  settings?: Record<string, unknown>; // full pass-through of Zoom's settings object
  [key: string]: unknown;
};

export type ZoomCreateResult = {
  id: number;
  uuid: string;
  join_url: string;
  start_time: string;
  topic: string;
  [key: string]: unknown;
};

export async function createMeeting(env: Bindings, hostEmail: string, payload: ZoomCreatePayload) {
  return zoomJson<ZoomCreateResult>(env, `/users/${encodeURIComponent(hostEmail)}/meetings`, {
    method: "POST",
    body: JSON.stringify({ type: 2, ...payload }), // type 2 = scheduled meeting
  });
}

export async function createWebinar(env: Bindings, hostEmail: string, payload: ZoomCreatePayload) {
  return zoomJson<ZoomCreateResult>(env, `/users/${encodeURIComponent(hostEmail)}/webinars`, {
    method: "POST",
    body: JSON.stringify({ type: 5, ...payload }), // type 5 = scheduled webinar
  });
}

export async function createZoomEvent(env: Bindings, type: ZoomEventType, hostEmail: string, payload: ZoomCreatePayload) {
  return type === "webinar" ? createWebinar(env, hostEmail, payload) : createMeeting(env, hostEmail, payload);
}

export async function getMeeting(env: Bindings, meetingId: string | number) {
  return zoomJson<ZoomCreateResult>(env, `/meetings/${meetingId}`);
}

export async function getWebinar(env: Bindings, webinarId: string | number) {
  return zoomJson<ZoomCreateResult>(env, `/webinars/${webinarId}`);
}

export type ZoomRegistrant = {
  email: string;
  first_name: string;
  last_name?: string;
};

export type ZoomRegistrantResult = {
  registrant_id: string;
  id: number;
  join_url: string;
  topic: string;
};

export async function addMeetingRegistrant(env: Bindings, meetingId: string | number, registrant: ZoomRegistrant) {
  return zoomJson<ZoomRegistrantResult>(env, `/meetings/${meetingId}/registrants`, {
    method: "POST",
    body: JSON.stringify(registrant),
  });
}

export async function addWebinarRegistrant(env: Bindings, webinarId: string | number, registrant: ZoomRegistrant) {
  return zoomJson<ZoomRegistrantResult>(env, `/webinars/${webinarId}/registrants`, {
    method: "POST",
    body: JSON.stringify(registrant),
  });
}

export async function addZoomRegistrant(
  env: Bindings,
  type: ZoomEventType,
  zoomEventId: string | number,
  registrant: ZoomRegistrant
) {
  return type === "webinar"
    ? addWebinarRegistrant(env, zoomEventId, registrant)
    : addMeetingRegistrant(env, zoomEventId, registrant);
}

type ZoomParticipant = {
  user_email?: string;
  name: string;
  join_time: string;
  leave_time: string;
  duration: number; // seconds, for this join/leave session
};

type ZoomParticipantsPage = {
  participants: ZoomParticipant[];
  next_page_token?: string;
};

// Past-webinar/meeting attendee report. A participant can appear multiple times (rejoins), so
// callers should sum `duration` per email across all pages.
async function fetchParticipantPages(env: Bindings, path: string): Promise<ZoomParticipant[]> {
  const all: ZoomParticipant[] = [];
  let nextPageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ page_size: "300" });
    if (nextPageToken) qs.set("next_page_token", nextPageToken);
    const page = await zoomJson<ZoomParticipantsPage>(env, `${path}?${qs.toString()}`);
    all.push(...(page.participants ?? []));
    nextPageToken = page.next_page_token || undefined;
  } while (nextPageToken);
  return all;
}

export async function getWebinarParticipantsReport(env: Bindings, webinarId: string | number) {
  return fetchParticipantPages(env, `/report/webinars/${webinarId}/participants`);
}

export async function getMeetingParticipantsReport(env: Bindings, meetingId: string | number) {
  return fetchParticipantPages(env, `/report/meetings/${meetingId}/participants`);
}

export async function getParticipantsReport(env: Bindings, type: ZoomEventType, zoomEventId: string | number) {
  return type === "webinar"
    ? getWebinarParticipantsReport(env, zoomEventId)
    : getMeetingParticipantsReport(env, zoomEventId);
}
