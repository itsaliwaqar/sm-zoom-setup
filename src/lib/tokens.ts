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
