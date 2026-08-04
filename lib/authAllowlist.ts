/**
 * Who may use this app.
 *
 * Two layers guard access: the Azure app registration is single-tenant (so only
 * Cider Press Microsoft accounts can authenticate at all), and this list decides
 * which of those accounts actually get in. Anyone else is rejected before a session
 * cookie is ever issued — see the signIn callback in auth.ts.
 *
 * To add or remove someone, edit this list. No roles, no database: five addresses.
 */
export const ALLOWED_EMAILS = [
  "jfurda@ciderpresswoodworks.com",
  "chris@ciderpresswoodworks.com",
  "karen@ciderpresswoodworks.com",
  "susan@ciderpresswoodworks.com",
  "rose@ciderpresswoodworks.com",
] as const;

const ALLOWED = new Set<string>(ALLOWED_EMAILS.map((e) => e.toLowerCase()));

/**
 * Is this address allowed in? Fails closed: null/undefined/blank is never allowed.
 * Comparison is case-insensitive and trimmed, since Entra ID can hand back an
 * address with different capitalization than the mailbox was created with.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ALLOWED.has(email.trim().toLowerCase());
}

/**
 * Pull the sign-in address out of an Entra ID profile. `email` is not reliably
 * populated in the ID token — for many tenants the address lives in
 * `preferred_username` (or `upn`), so all three are checked in order.
 */
export function emailFromEntraProfile(
  profile: Record<string, unknown> | null | undefined
): string {
  const candidates = [
    profile?.email,
    profile?.preferred_username,
    profile?.upn,
    profile?.unique_name,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
