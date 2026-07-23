# Security Audit — CPW Innergy → Sage Intacct Exporter

**Date:** 2026-07-23
**Scope:** (1) Does Microsoft auth protect the site right now? (2) Will Sage API keys be secure when we integrate Sage directly?
**Method:** Read-only source review + git-history scan + live probing of the production Vercel deployment.

---

## TL;DR

1. **There is no Microsoft authentication anywhere in this project** — not in the app code, not in Vercel. The production site and its API routes are **open to the public internet right now**, and they serve **live customer names, invoice numbers, and dollar amounts**. This is a live data exposure, not a theoretical one.
2. **The Sage question is the same question.** The app already keeps API keys server-side (good, keep it) — key *secrecy* was never the real risk. The real risk is the **unauthenticated proxy**: anyone can invoke it. Today that leaks Innergy reads. With Sage wired in, those calls become **writes to your accounting system** (bills, invoices, journal entries). **You cannot have "100% secure Sage keys" until the authentication gap is closed first.** Part 1 is a prerequisite for Part 2.

---

## Part 1 — Does Microsoft auth protect everything right now? **No.**

### Evidence

- **No auth in code.** `package.json` has no auth library (no `next-auth`, no `@azure/msal-*`, no Supabase). There is **no `middleware.ts`**, and none of the three API route handlers (`app/api/purchase-orders/route.ts`, `app/api/purchase-orders/[id]/route.ts`, `app/api/invoices/route.ts`) check identity, session, or a token. They call Innergy and return the data to anyone.
- **The README says so explicitly:** *"the app has no authentication — keep the URL internal."*
- **No Vercel protection either.** Team `jason-furdas-projects` has no SAML SSO configured (`saml: {}`). Live probe of the production alias `cpw-innergy-pos-to-sage-intacct.vercel.app`:

  | URL | Result |
  |---|---|
  | `/` | **HTTP 200** — no SSO challenge, no auth cookie |
  | `/api/invoices` | **HTTP 200** — returned live invoice JSON |
  | `/api/purchase-orders` | **HTTP 200** — returned live PO JSON |

- **Confirmed live leak.** `/api/invoices` publicly returned real records, e.g. customer `RW Guild`, invoice `INV-26-100000`, `invoiceAmount 3254.22`, project `RW Stockholm Test (clone)`. Anyone with the URL — or anyone who finds it (search crawlers, referrer logs, shared links) — can read this.

### What "internal URL" is worth as protection

Nothing. An unlisted `*.vercel.app` URL is security-by-obscurity. It is discoverable and is not access control.

### The one thing done right

The Innergy key is used **server-side only** (`lib/innergy.ts` reads `process.env.INNERGY_API_KEY`; the browser never sees it). Git history is clean — the key was **never committed** (`.env.local` is gitignored and absent from history; only the empty `.env.example` placeholder is tracked). Keep this pattern.

---

## Part 2 — Will the Sage API keys be 100% secure? **Not until the auth gap is fixed — and "100%" is the wrong target.**

### Reframe the risk

The current design already prevents the *key* from reaching the browser. So "keeping the key secret" is largely handled. The exposure that matters is different:

> **An open, unauthenticated proxy means anyone can make the app act with your Sage credentials — regardless of how well the key itself is hidden.**

- **Innergy today:** open proxy → data **read** leak (bad, but read-only).
- **Sage tomorrow:** the operations behind Intacct credentials are **writes** — posting AP bills, AR invoices, journal entries into your live accounting system. An open proxy would let anyone on the internet push financial transactions into Intacct. That is a materially worse blast radius.

**Therefore closing Part 1 is a hard prerequisite for Part 2.** Secure key storage on top of an unauthenticated endpoint is not secure.

### Sage Intacct specifics (verified against the `sage-intacct` skill)

- **Intacct auth is OAuth 2.0, not a single static key.** You will hold a **client ID + client secret**, and depending on flow, **tokens**:
  - *Client-credentials flow* (server-to-server, no user context): client ID/secret in Vercel env vars is appropriate.
  - *Authorization-code / refresh-token flow*: the **refresh token is a long-lived secret**. Vercel env vars store static config well but are a poor home for rotating/renewed tokens — that path needs durable secure storage (e.g. a secrets manager or an encrypted row in a DB) and a **rotation plan**.
- **Least privilege:** provision the Sage web-services / API role with only the AP/AR/GL permissions this app actually posts — not an admin role.
- **Never** expose any Sage value via a `NEXT_PUBLIC_*` variable (those are inlined into the client bundle).
- **Audit logging:** log who exported/posted what, so a Sage write is always traceable to an authenticated user.

### Honest definition of "secure" (there is no 100%)

Target this, not "100%":
1. Secrets server-side only (already the pattern) — keep
2. **Authenticated access** — every endpoint requires a logged-in, authorized user — **missing, must add**
3. Least-privilege Sage role — do at integration time
4. Token rotation + secure storage for OAuth refresh tokens — do at integration time
5. Audit trail of writes — do at integration time

---

## Remediation

### Immediate (do today — data is exposed live)

**Enable Vercel Deployment Protection** on the project (Dashboard -> project -> Settings -> Deployment Protection). "Vercel Authentication" (Standard Protection) requires a Vercel account login for **all** deployments and closes the hole in minutes. This is the fastest stopgap while proper SSO is built.

- **Trap to avoid:** protection (and any custom-domain gateway) must cover the **raw `*.vercel.app` URLs too**. All three current aliases and any preview URL must be gated — a firewall on the custom domain alone is bypassed by the deployment URLs.

### Proper fix (before or alongside Sage integration)

**Add real application-level Microsoft 365 SSO** so only your team can access the app and every request carries an authenticated identity. The `setup-ms365-supabase-auth` skill covers exactly this (Entra ID -> Supabase Auth broker -> Next.js middleware gate + RLS). This is the durable answer to "does Microsoft auth protect everything."

- Add a `middleware.ts` that rejects unauthenticated requests to **both** pages and `/api/*` routes.
- Restrict sign-in to your Microsoft 365 tenant/domain.

### At Sage integration time

- OAuth2 client-credentials where possible; env vars for client ID/secret.
- If refresh tokens are involved: durable secure storage + rotation path (not bare env vars).
- Least-privilege Intacct API role.
- Per-user audit log of every Sage write.

---

## Bottom line

- **Right now:** the site is public and leaking live financial data. Fix that today with Vercel Deployment Protection.
- **The Microsoft auth you believe is protecting the site does not exist yet** — build it (MS365 SSO) before relying on it.
- **Sage keys can be made secure** — the server-side pattern is already correct — **but only once the app requires authenticated access.** Until then, storing the Sage secret well protects the key while leaving the door it opens wide open.
