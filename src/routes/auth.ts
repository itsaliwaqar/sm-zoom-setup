import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { clearLoginFailures, createSession, deleteSession, isLockedOut, recordLoginFailure } from "../lib/sessions";
import { optionalSession, SESSION_COOKIE } from "../lib/auth";

const app = new Hono<AppEnv>();

function setSessionCookie(c: import("hono").Context<AppEnv>, token: string) {
  const isHttps = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

app.get("/setup-status", async (c) => {
  const db = getDb(c.env.DB);
  const anyUser = await db.select().from(schema.users).limit(1).get();
  return c.json({ needsSetup: !anyUser });
});

app.post("/setup", async (c) => {
  const db = getDb(c.env.DB);
  const anyUser = await db.select().from(schema.users).limit(1).get();
  if (anyUser) return c.json({ error: "setup has already been completed" }, 409);

  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password || body.password.length < 8) {
    return c.json({ error: "email and a password of at least 8 characters are required" }, 400);
  }

  const id = crypto.randomUUID();
  await db.insert(schema.users).values({
    id,
    email: body.email.toLowerCase(),
    passwordHash: await hashPassword(body.password),
    role: "admin",
    lastLoginAt: new Date(),
  });

  const token = await createSession(c.env, { userId: id, email: body.email.toLowerCase(), role: "admin" });
  setSessionCookie(c, token);
  return c.json({ id, email: body.email.toLowerCase(), role: "admin" }, 201);
});

app.post("/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) return c.json({ error: "email and password are required" }, 400);
  const email = body.email.toLowerCase();

  if (await isLockedOut(c.env, email)) {
    return c.json({ error: "too many failed attempts - try again in 15 minutes" }, 429);
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    await recordLoginFailure(c.env, email);
    return c.json({ error: "invalid email or password" }, 401);
  }

  await clearLoginFailures(c.env, email);
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));

  const token = await createSession(c.env, { userId: user.id, email: user.email, role: user.role });
  setSessionCookie(c, token);
  return c.json({ id: user.id, email: user.email, role: user.role });
});

app.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  await deleteSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/me", optionalSession, async (c) => {
  const session = c.var.session;
  if (!session) return c.json({ error: "not logged in" }, 401);
  return c.json({ id: session.userId, email: session.email, role: session.role });
});

export default app;
