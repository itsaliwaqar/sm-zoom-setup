// Shared "computed value" vocabulary used by GHL field mapping, Google Sheets column mapping,
// and SendBlue custom variables. Each mapping entry a user configures is either a static string
// or one of these tokens, resolved at registration time from the actual registrant/event data.
export const TOKEN_KEYS = [
  "email",
  "firstName",
  "lastName",
  "phone",
  "webinarTopic",
  "webinarDateEastern",
  "webinarDateUtc",
  "joinUrl",
  "shortJoinUrl",
  "zoomRegistrantId",
  "routeSlug",
  "attendanceStatus", // only populated once attendance sync has run; "" at registration time
  "attendedMinutes",
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export type TokenContext = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  webinarTopic: string;
  webinarDateEastern: string;
  webinarDateUtc: string;
  joinUrl: string;
  shortJoinUrl: string;
  zoomRegistrantId: string;
  routeSlug: string;
  attendanceStatus?: string;
  attendedMinutes?: number;
};

export function resolveTokens(ctx: TokenContext): Record<TokenKey, string> {
  return {
    email: ctx.email,
    firstName: ctx.firstName ?? "",
    lastName: ctx.lastName ?? "",
    phone: ctx.phone ?? "",
    webinarTopic: ctx.webinarTopic,
    webinarDateEastern: ctx.webinarDateEastern,
    webinarDateUtc: ctx.webinarDateUtc,
    joinUrl: ctx.joinUrl,
    shortJoinUrl: ctx.shortJoinUrl,
    zoomRegistrantId: ctx.zoomRegistrantId,
    routeSlug: ctx.routeSlug,
    attendanceStatus: ctx.attendanceStatus ?? "",
    attendedMinutes: ctx.attendedMinutes !== undefined ? String(ctx.attendedMinutes) : "",
  };
}

export type MappingEntry = {
  source: "token" | "static";
  token?: TokenKey;
  staticValue?: string;
};

export function renderMapping(entry: MappingEntry, tokens: Record<TokenKey, string>): string {
  if (entry.source === "static") return entry.staticValue ?? "";
  if (entry.token && entry.token in tokens) return tokens[entry.token];
  return "";
}

// Shared by registerWebhook.ts and attendance.ts for parsing the JSON config blobs stored on a
// registration route (ghlOutputFieldsJson, sheetsConfigJson, etc.) - never throws.
export function parseJson<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// Shapes of the JSON config blobs stored on a registration_routes row - shared by
// registerWebhook.ts (registration time) and attendance.ts (post-event) so both act on the
// same per-route configuration.
export type GhlOutputField = MappingEntry & { fieldId: string; fieldName?: string };
export type SheetsConfig = { enabled: boolean; spreadsheetId?: string; sheetName?: string; columns: (MappingEntry & { header: string })[] };
export type SendblueConfig = { enabled: boolean; tags: string[]; customVariables: (MappingEntry & { label: string })[] };
export type HyrosConfig = { enabled: boolean; tags: string[]; source?: string };
export type OutboundWebhookConfig = { enabled: boolean; url?: string };
