export type Bindings = {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  ASSETS: Fetcher;

  ADMIN_API_KEY: string;
  ZOOM_ACCOUNT_ID: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
  GHL_PRIVATE_TOKEN: string;
  GHL_DEFAULT_LOCATION_ID: string;

  PUBLIC_BASE_URL?: string;
  GHL_ATTENDED_TAG?: string; // default: "Webinar Attended"
  GHL_NO_SHOW_TAG?: string; // default: "Webinar No-Show"
};

export type Variables = {
  // Populated by requireAuth/optionalAuth when the request carries a valid session cookie.
  // `authType` distinguishes a session login from a raw X-API-Key request (which has no user).
  session: import("./lib/sessions").SessionData | null;
  authType: "session" | "apiKey" | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
