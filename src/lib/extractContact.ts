function pick(body: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = body[key];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return undefined;
}

// Covers the common key shapes sent by ClickFunnels, GHL workflow "Webhook" actions, and Zapier.
const DEFAULT_KEYS = {
  email: ["email", "Email", "emailAddress", "email_address", "contact_email"],
  firstName: ["firstName", "first_name", "First Name", "fname"],
  lastName: ["lastName", "last_name", "Last Name", "lname"],
  phone: ["phone", "Phone", "phone_number", "contact_phone"],
};

export function extractContact(
  body: Record<string, unknown>,
  fieldMapping?: Record<string, string>
): { email?: string; firstName?: string; lastName?: string; phone?: string } {
  const contact = (body.contact as Record<string, unknown>) ?? {};
  const flat = { ...contact, ...body };

  const resolve = (key: keyof typeof DEFAULT_KEYS) =>
    fieldMapping?.[key] !== undefined ? pick(flat, [fieldMapping[key]]) : pick(flat, DEFAULT_KEYS[key]);

  return {
    email: resolve("email"),
    firstName: resolve("firstName"),
    lastName: resolve("lastName"),
    phone: resolve("phone"),
  };
}
