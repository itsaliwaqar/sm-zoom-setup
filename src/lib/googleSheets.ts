import type { Bindings } from "../env";

const TOKEN_CACHE_KEY = "google:access_token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

function base64UrlFromBytes(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlFromString(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function parseServiceAccount(env: Bindings): ServiceAccount {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Google service account JSON is not configured (Settings > Credentials)");
  }
  try {
    return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("Google service account JSON is not valid JSON");
  }
}

async function signJwt(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: SHEETS_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64UrlFromString(JSON.stringify(header));
  const encodedClaims = base64UrlFromString(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(signature)}`;
}

async function getAccessToken(env: Bindings): Promise<string> {
  const cached = await env.CACHE_KV.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const sa = parseServiceAccount(env);
  const jwt = await signJwt(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await env.CACHE_KV.put(TOKEN_CACHE_KEY, data.access_token, { expirationTtl: Math.max(60, data.expires_in - 120) });
  return data.access_token;
}

export async function appendRow(
  env: Bindings,
  opts: { spreadsheetId: string; sheetName: string; values: string[] }
): Promise<void> {
  const token = await getAccessToken(env);
  const range = encodeURIComponent(`${opts.sheetName}!A1`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${opts.spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [opts.values] }),
    }
  );
  if (!res.ok) {
    throw new Error(`Google Sheets append failed: ${res.status} ${await res.text()}`);
  }
}
