# CLAUDE.md

Working notes for this repo. `README.md` is the reference (field mappings, verified API
behaviour, setup steps) — read it before touching the Sage or Innergy code. This file covers
what's operational: current state, live blockers, and traps that cost time.

## What this app is

Next.js (App Router, TS) on Vercel. Lists records pulled live from Innergy and gets them into
Sage Intacct. Four things exist:

- `/` **Bills (AP)** — reconciled PO → AP Bill `.csv` (52-column contract, `lib/sageColumns.ts`)
- `/invoices` **Invoices (AR)** — one invoice, two routes: **Post to Sage** (API, via
  `lib/sageInvoiceFromInnergy.ts`) and **Export .csv** (45-column, `lib/arColumns.ts`)
- `/sage` **Sage API (test)** — the API workbench: connection check, list invoices, clone/post
- `/login` — Microsoft sign-in gating everything above.

Both invoice routes read the same constants out of `lib/arColumns.ts`, so they can't disagree
about accounts, dimensions or fallbacks. The `.csv` path stays until taxed invoices can post.

## Current state (2026-08-05)

**Working:** Microsoft auth on production; Sage connection + invoice listing per entity
(top level / 10 / 20 / 30); clone dialog prefilled from any existing invoice, including
subtotal rows; Innergy invoice → Sage draft mapper + Post to Sage button (unit tested against
the `.csv` rows, not yet exercised live).

**Not yet done:** no invoice has been *successfully* created through the API. Three attempts,
three different refusals, all now understood and documented in README. The next test is cloning
invoice 40 (`INV-MKC-26-100002` — single labelled line, no tax) as a draft; that path needs no
GL override and should be the first success.

**Also unverified live:** whether the `.csv` dimension values (`20-PA`, `FURNITURE`, project
`TEST`) are the ids the REST API wants. Read them back off invoice 40's lines with
`listSageInvoiceLines()` once a token works — cheaper than a 422.

**Blocked pending Sage configuration:** taxed invoices cannot post via the API, and **every live
Innergy invoice is taxed** (1 of 1 on 2026-08-05), so the API path covers nothing real yet. Every
AR account label that points at a tax account is a *subtotal* label, and those are invalid on line
items; the only alternative is naming account 33500 directly, which Sage refuses as a GL account
override for API calls (the .csv import route is allowed to do it — same user, different door).
Fix is one of: create a non-subtotal label for 33500 (then put its id in
`AR_SALES_TAX_ACCT_LABEL`), or enable GL account override under Configure Accounts Receivable.
See README for the full label table.

**Auth:** `lib/sage.ts` prefers client credentials and self-mints tokens as soon as
`SAGE_WS_USER` holds a real `userId@companyId`; `SAGE_ACCESS_TOKEN` is only the fallback while it
doesn't. Creating that Web Services user (+ Authorized Client Applications pairing, + an AR-create
role) is the one-time job that ends the daily token paste. No refresh-token storage is involved,
which is why this beats the authorization-code flow in an app with no database.

## Traps that already cost time

- **`GET /objects/accounts-receivable/invoice/{key}` hides subtotal lines.** Invoice 24
  (`IN-1002`) returns one 1300.00 line but totals 1378.00. Always read lines via the query
  service (`listSageInvoiceLines()`), or clones silently post short invoices.
- **Entity header is `X-IA-API-Param-Entity`.** `Sage-Param-Entity` (from the RKL meeting notes)
  is accepted and *silently ignored* — every entity value returns the full top-level set, so a
  wrong header name looks like success.
- **`caseSensitiveComparison` / `includePrivate` go inside `filterParameters`.** At the top level
  the query payload is rejected outright.
- **`ia::error` is sometimes nested under `ia::result`.** Check both or the readable message is
  lost to raw truncation.
- **Amount fields are `totalTxnAmount` / `totalTxnAmountDue`** (no `totalDueTxnAmount`), returned
  as strings. `customer` is a ref, absent from the object model's field list.
- **Blank ref ids are rejected** — omit `{ "id": "" }` entirely.
- Use `GET /services/core/model?name=<object>` to confirm field names instead of guessing. It
  reports `readOnly`, which is how the `isSubtotal` dead end was identified.
- **`state` accepts only `"draft"` on create.** `"posted"` — what the model lists and a read
  returns — is a 400: *"State must be draft or not included in the request."* Posted means
  omitting the field. A writable-looking enum value is not necessarily writable *on create*.

## Auth and secrets

- Whole app behind Microsoft (Entra ID) via Auth.js v5. No database, no Supabase — session is a
  signed cookie. Access is limited to five addresses in `lib/authAllowlist.ts`; edit that list to
  add or remove someone. `middleware.ts` re-checks per request.
- Vercel Authentication cannot cover production on this plan (`428 invalid_sso_protection`),
  which is why the gate is in the app. Before it existed, the production URL served Innergy data
  publicly.
- **`SAGE_ACCESS_TOKEN` expires every 12 hours.** While it is the active mode, `/sage` erroring is
  almost always why — mint a fresh token (Sage's Postman collection, logging in against
  `ciderpresswoodworks-imp`) and update `.env.local` and the Vercel env. Permanent fix: set
  `SAGE_WS_USER=userId@ciderpresswoodworks-imp` for a Web Services user, which switches the app to
  self-minted client-credentials tokens.
- CPW tenant id is `928cd2c2-691a-44b4-90a4-5ab057b45b99`. Resolve it from the domain if in
  doubt (`login.microsoftonline.com/ciderpresswoodworks.com/v2.0/.well-known/openid-configuration`)
  — an Object ID was mistaken for it once, giving `AADSTS90002: Tenant not found`.

## Working agreements

- Commit and push verified changes without asking. Pushing `main` deploys production
  immediately — make sure required env vars exist there *first*, or every page 500s.
- **Permission classifier blocks two things**, and they need the user's hands: writing secrets to
  Vercel (`vercel env add` with a secret value) and running scripts that POST to Sage. Non-secret
  env vars (client id, issuer, entity) can be set normally. Don't route around a denial; hand
  over the exact commands.
- Diagnose Sage failures from the literal error text — get the exact message, don't act on a
  paraphrase. The client deliberately preserves full `ia::error.details[]`.
- Meeting notes live in **Notion**, not SharePoint (its search also covers Outlook and Teams).
  RKL's developer contact is Lindsey Klatzkin. Verify anything from those notes against the live
  API — the entity header name in them was wrong, and it fails silently.
- Scratch probe scripts belong in the session scratchpad, not the repo. `npm test` guards the CSV
  header contracts and the Sage payload builder; run it plus `npm run build` (type-check) before
  pushing.

## Open questions for RKL

- Subtotal rows appear to be manual-entry only: `isSubtotal` is read-only, AR invoices have no
  subtotals collection, and subtotal labels are invalid on line items. Confirm, and confirm
  whether the legacy XML API or an Order Entry sales document with a subtotal template can do it.
  Since the GL effect is identical (AR debit = revenue + tax), this may be purely cosmetic.
- Why the .csv import may override GL accounts while the REST API may not, and which of the two
  unblocking options above they'd rather we use. **This is the critical path** — with every live
  Innergy invoice taxed, the API route is unusable until it's answered.
- Still unmapped on the CSV side: `DEPT_ID` (Furniture vs Millwork), `LOCATION_ID`, and
  `AR_REVENUE_ACCT_NO` (deliberately blank — must never be the AP account 32000).
