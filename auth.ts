/**
 * Microsoft Entra ID (MS365) sign-in for the whole app, via Auth.js v5.
 *
 * No database and no Supabase: the session is a signed JWT in an httpOnly cookie,
 * and identity comes straight from Entra. Two layers of restriction:
 *
 *  1. The Azure app registration is single-tenant and AUTH_MICROSOFT_ENTRA_ID_ISSUER
 *     points at the Cider Press tenant (never /common), so only CPW accounts can
 *     authenticate.
 *  2. The signIn callback below rejects any address not in lib/authAllowlist.ts, so
 *     a rejected user never receives a session cookie at all — Auth.js sends them to
 *     /login?error=AccessDenied, which the login page explains.
 */
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { emailFromEntraProfile, isAllowedEmail } from "@/lib/authAllowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    /** Gate on the allowlist before any session is created. */
    signIn({ profile }) {
      return isAllowedEmail(emailFromEntraProfile(profile));
    },
    /**
     * Keep the resolved address on the token so server code can show who is signed
     * in without another Entra round-trip.
     */
    jwt({ token, profile }) {
      if (profile) {
        const email = emailFromEntraProfile(profile);
        if (email) token.email = email;
      }
      return token;
    },
    session({ session, token }) {
      if (token.email) session.user.email = token.email;
      return session;
    },
  },
});
