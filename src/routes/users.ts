import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { requireAdminRole, requireSession } from "../lib/auth";

const app = new Hono<AppEnv>();

function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

async function adminCount(db: ReturnType<typeof getDb>): Promise<number> {
  const admins = await db.select().from(schema.users).where(eq(schema.users.role, "admin")).all();
  return admins.length;
}

app.get("/", requireAdminRole, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .all();
  return c.json(rows);
});

app.post("/", requireAdminRole, async (c) => {
  const body = await c.req.json<{ email: string; role: "admin" | "member"; password?: string }>();
  if (!body.email || !body.role) return c.json({ error: "email and role are required" }, 400);
  const email = body.email.toLowerCase();

  const db = getDb(c.env.DB);
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) return c.json({ error: "a user with this email already exists" }, 409);

  const generatedPassword = body.password ? undefined : generatePassword();
  const password = body.password ?? generatedPassword!;
  if (password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);

  const id = crypto.randomUUID();
  await db.insert(schema.users).values({ id, email, passwordHash: await hashPassword(password), role: body.role });

  return c.json({ id, email, role: body.role, generatedPassword }, 201);
});

app.patch("/:id", requireAdminRole, async (c) => {
  const userId = c.req.param("id");
  if (!userId) return c.json({ error: "id is required" }, 400);
  const body = await c.req.json<{ role: "admin" | "member" }>();
  if (!body.role) return c.json({ error: "role is required" }, 400);

  const db = getDb(c.env.DB);
  const target = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!target) return c.json({ error: "not found" }, 404);

  if (target.role === "admin" && body.role === "member" && (await adminCount(db)) <= 1) {
    return c.json({ error: "can't demote the last remaining admin" }, 400);
  }

  await db.update(schema.users).set({ role: body.role }).where(eq(schema.users.id, target.id));
  return c.json({ ok: true });
});

app.delete("/:id", requireAdminRole, async (c) => {
  const userId = c.req.param("id");
  if (!userId) return c.json({ error: "id is required" }, 400);
  const session = c.var.session!;
  if (session.userId === userId) {
    return c.json({ error: "you can't delete your own account" }, 400);
  }

  const db = getDb(c.env.DB);
  const target = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!target) return c.json({ error: "not found" }, 404);

  if (target.role === "admin" && (await adminCount(db)) <= 1) {
    return c.json({ error: "can't delete the last remaining admin" }, 400);
  }

  await db.delete(schema.users).where(eq(schema.users.id, target.id));
  return c.json({ ok: true });
});

app.patch("/me/password", requireSession, async (c) => {
  const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
  if (!body.currentPassword || !body.newPassword || body.newPassword.length < 8) {
    return c.json({ error: "currentPassword and a newPassword of at least 8 characters are required" }, 400);
  }

  const db = getDb(c.env.DB);
  const user = await db.select().from(schema.users).where(eq(schema.users.id, c.var.session!.userId)).get();
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
    return c.json({ error: "current password is incorrect" }, 401);
  }

  await db.update(schema.users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(schema.users.id, user.id));
  return c.json({ ok: true });
});

export default app;
