# CPW Innergy → Sage Intacct Exporter

Internal web app that lists records pulled live from Innergy and exports them to `.xlsx`
files matching Sage Intacct import templates. Three tabs:

- **Bills (AP)** — `/` — exports a **reconciled** purchase order to the **AP Bill** template
  (`Accounts Payable bills.xls`). One PO = one bill line.
- **Invoices (AR)** — `/invoices` — exports an invoice to the **AR Invoice** template
  (`Accounts Receivable invoices (Innergy Field Mapping).xls`). One invoice = one line;
  no status gate (any invoice can be exported).
- **Sage API (test)** — `/sage` — talks to the Sage Intacct REST API directly instead of
  generating a file. Read-only today (connection test + list AR invoices); the eventual
  goal is posting invoices straight into Sage.

## Access control (Microsoft sign-in)

The **whole app** requires a Microsoft (Entra ID / MS365) login — every page and every
`/api/*` route. No Supabase and no database: Auth.js v5 puts a signed JWT in an httpOnly
cookie, and Microsoft is the only identity provider.

Access is restricted twice over:

1. The Azure app registration is **single-tenant**, and `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
   points at the CPW tenant. Using `/common` there would let any Microsoft account in the
   world reach step 2 — don't.
2. `lib/authAllowlist.ts` lists the five addresses that may use the app. Anyone else is
   rejected in the `signIn` callback, so they never receive a session cookie, and land on
   `/login?error=AccessDenied` with an explanation.

**To add or remove someone:** edit `ALLOWED_EMAILS` in `lib/authAllowlist.ts` and deploy.
`middleware.ts` re-checks the list on every request, so a removal takes effect on that
person's next request rather than whenever their existing session expires.
`lib/authAllowlist.test.ts` covers case-insensitivity, blank input (fails closed), and
near-miss addresses.

Entra ID does **not** reliably populate the `email` claim — for many tenants the address
arrives in `preferred_username`. `emailFromEntraProfile()` checks `email`,
`preferred_username`, `upn`, then `unique_name`, and a profile with none of them yields
`""`, which fails the allowlist. That's safe, but if *everyone* is suddenly locked out,
this is the first thing to look at.

### Azure app registration

1. Azure Portal → **App registrations** → **New registration**. Single tenant
   ("Accounts in this organizational directory only").
2. **Authentication** → **Add a platform** → **Web**, and add **both** redirect URIs:
   - `https://cpw-innergy-pos-to-sage-intacct.vercel.app/api/auth/callback/microsoft-entra-id`
   - `http://localhost:3000/api/auth/callback/microsoft-entra-id` (without this, login
     cannot be tested locally)
3. **Certificates & secrets** → **New client secret** → copy the **Value** (shown once)
   and note the expiry; login breaks when it lapses.
4. From **Overview**, take the **Application (client) ID** and **Directory (tenant) ID**.

Then set `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`,
`AUTH_MICROSOFT_ENTRA_ID_ISSUER` (`https://login.microsoftonline.com/<TENANT_ID>/v2.0`), and
`AUTH_SECRET` (`openssl rand -base64 32`) in `.env.local` and in the Vercel project env.
The default scope requests `User.Read` so Auth.js can fetch the profile photo; a missing
photo is handled and does not fail the login.

> Note: the gate is **cookie-based**, which suits a browser-driven tool. If a cron job or
> other unattended caller ever needs to hit these routes — e.g. once invoices post to Sage
> automatically — it needs a separate machine-auth path (a shared secret header or a service
> token); a session cookie won't do.

## Stack

- Next.js (App Router, TypeScript), deployed on Vercel
- Server-side API routes proxy Innergy so the API key never reaches the browser
- Excel generated client-side with [SheetJS](https://sheetjs.com) (`xlsx`)

## Local development

```bash
npm install
cp .env.example .env.local     # then fill in INNERGY_API_KEY
npm run dev                    # http://localhost:3000
```

### Environment variables

| Var | Required | Notes |
|-----|----------|-------|
| `AUTH_SECRET` | yes | Signs the session cookie. `openssl rand -base64 32`. |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | yes | Azure Application (client) ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | yes | Azure client secret **Value**. |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | yes | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` — never `/common`. |
| `INNERGY_API_KEY` | yes | Sent as the raw `Api-Key` header. Needs `Purchasing → PurchaseOrder → View`. |
| `INNERGY_BASE_URL` | no | Defaults to `https://app.innergy.com`. |
| `SAGE_ACCESS_TOKEN` | Sage tab | Hand-minted token (Postman). Lasts 12h — see below. |
| `SAGE_CLIENT_ID` | client creds | From the Sage App Registry entry for this app. |
| `SAGE_CLIENT_SECRET` | client creds | Never leaves the server. |
| `SAGE_WS_USER` | client creds | `userId@companyId`, e.g. `someUser@ciderpresswoodworks-imp`. |
| `SAGE_ENTITY_ID` | no | Default sub-entity (10/20/30); the tab overrides per request. |
| `SAGE_BASE_URL` | no | Defaults to `https://api.intacct.com/ia/api/v1`. |

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build (also type-checks)
- `npm test` — unit tests (header-contract + row-mapping)

## How it works

1. `GET /api/purchase-orders` → Innergy `GET /api/purchaseOrders`, normalized to a trimmed list.
2. The page renders a searchable/filterable table. **Export is enabled only for reconciled POs.**
3. On export, the app re-fetches PO detail (`/api/purchase-orders/[id]`) for fresh numbers,
   builds the workbook, and downloads it.

### The 52-column contract

`lib/sageColumns.ts` holds the exact header row and the PO→row mapping. **Do not reorder or
rename** these headers — the Sage importer matches on them. `lib/sageColumns.test.ts` fails if
the header array ever drifts from the template. Mapped columns:

| Sage column | Source |
|---|---|
| BATCH_TITLE | batch title from the export dialog (Sage pre-pends "HISTORY – ") |
| BILL_NO / PO_NO | PO number |
| VENDOR_ID | Vendor's External Id |
| PAYTO | Vendor contact |
| CREATED_DATE / EXCH_RATE_DATE | today (`MM/DD/YYYY`) |
| TOTAL_DUE / AMOUNT | Received Total Cost |
| TERM_NAME | Payment terms |
| LINE_NO | `1` |
| MEMO | `Innergy Export` |
| ACCT_NO | `32000` (see below) |
| ACTION | `Submit` |

All other columns are exported blank. The exported file contains **only the header row + data
rows** (the template's `#` comment rows are omitted; Sage ignores them anyway).

Tunable constants live at the top of `lib/sageColumns.ts`: `DEFAULT_ACCT_NO` (currently
`32000`, flagged "will this change?" in the template), `EXPORT_MEMO`, `BILL_ACTION`.

## Innergy response notes (verified live, 2026-07)

`lib/innergy.ts#normalizePO` maps the real Innergy PO schema:

- The list endpoint returns `{ CreateDate, Items: [...] }`, and Innergy 302-redirects to a
  short-lived, **gzip** Azure blob URL. Node's `fetch` follows the redirect and decompresses
  (`Content-Encoding: gzip`) automatically.
- The **detail endpoint keys off the PO `Number`** (e.g. `PO-100002`), **not** the UUID `Id`
  (passing the UUID returns `400 Invalid Id`), and returns the record directly.
- Field mapping: `Number` → PO #, `Vendor` (a plain string) → vendor name,
  `VendorExternalIdentifier` → `VENDOR_ID`, `VendorContactName` → `PAYTO`,
  `PaymentTerms` → `TERM_NAME`, and `ReceivedTotalCost` is a money object
  `{ Value, CurrencyCode }` → we use `.Value`.
- Reconciled gate: `Status === "Reconciled"`.

Note: several of these fields (vendor external id, contact, terms) can be blank/null on a given
PO in Innergy — that's real data, not a mapping error. Set the vendor's External Id in Innergy so
`VENDOR_ID` populates for the Sage import.

## Invoices (AR) tab

`GET /api/invoices` → Innergy `GET /api/invoices`. `lib/arColumns.ts` holds the exact 54-column
AR Invoice header row and the invoice→row mapping (`lib/arColumns.test.ts` guards the headers).
No status gate — any invoice can be exported.

Innergy invoice schema notes (verified live, 2026-07):

- `/api/invoices` returns invoices **grouped by project**: `{ Items: [ { Project, ...totals,
  Items: [invoice...] } ] }`. `listInvoices` flattens the inner `Items` to one list.
- Invoices are tied to **WorkOrders/Projects, not POs** (`BillingType: "WO"`).
- The invoice record carries the customer **name** only, not an external id. `CUSTOMER_ID` is
  resolved by matching that name against `/api/companies` → `ExternalIdentifier` (cached 5 min).
  All external ids are currently null, so `CUSTOMER_ID` exports blank; once the Sage customer ID
  is set on each customer's External Id field in Innergy, it links automatically.

Mapped columns:

| AR column | Source |
|---|---|
| BATCH_TITLE | batch title from the export dialog |
| INVOICE_NO | `InvoiceNumber` |
| PO_NO | Work Order number(s), comma-joined |
| CUSTOMER_ID | customer External Id (blank until set in Innergy — see above) |
| CREATED_DATE / EXCH_RATE_DATE | today (`MM/DD/YYYY`) |
| DUE_DATE | Innergy `DueDate` (`MM/DD/YYYY`) |
| TOTAL_DUE | `InvoiceAmount` (total incl. tax) |
| AMOUNT (revenue line) | `InvoicePreTaxAmount` (pre-tax) |
| LINE_NO | `1` revenue line, `2` tax line |
| MEMO | `Innergy Export` (revenue), `Sales Tax` (tax line) |
| ARINVOICEITEM_ARACCOUNT | `12100` — AR control account (`AR_CONTROL_ACCT_NO`) |
| ACCT_NO | **blank** revenue (`AR_REVENUE_ACCT_NO`); `33500` on the tax line |

`TERM_NAME`, `ACTION`, and all rev-rec / subtotal columns export blank (no Innergy
equivalent; `ACTION` blank → Sage defaults to Submit). The two AR GL accounts live in
`lib/arColumns.ts` and are deliberately **not** shared with the AP side:

- `ARINVOICEITEM_ARACCOUNT = "12100"` — the Accounts Receivable control account (the debit),
  confirmed from RKL's manual example (invoice IN-1002).
- `ACCT_NO` (the revenue credit) is **left blank on purpose.** It must never be the AP account
  (32000). The real value is a 5,200-series revenue account (e.g. 50200 Furniture Sales vs a
  Millwork account) that depends on the unresolved furniture/millwork split — set
  `AR_REVENUE_ACCT_NO` once that's decided. The export dialog warns while it's blank.

**Sales tax:** taxable invoices export **two lines** — a pre-tax revenue line (line 1) and a
sales-tax line (line 2, `AMOUNT = InvoiceSalesTax`) posting to `AR_SALES_TAX_ACCT_NO` (`33500`,
from RKL's IN-1002 example). Untaxed invoices stay a single line. Tax is written as a plain GL
line, **not** via the template's `SUBTOTAL="T"` flag — that flag requires Account Labels, which
aren't mapped; the GL effect is identical (AR debit = revenue + tax). Verify against a Sage test
import, and confirm `33500` applies to all entities.

**Not yet mapped (needs setup in Innergy / a decision):** `DEPT_ID` (Furniture vs Millwork),
`LOCATION_ID` (entity/facility, e.g. `20-PA`), and `ARINVOICEITEM_PROJECTID` (Sage project IDs).
See the field-mapping reference for the full picture.

## Sage API (test) tab

`/sage` is the direct-API path that will eventually replace the file exports. Today it is
**read-only**: nothing on this tab writes to Sage.

- `GET /api/sage/status` — proves auth works and returns only the auth mode, token expiry (if
  known), and which company/entity we are pointed at. **The access token is never returned to
  the browser.**
- `GET /api/sage/invoices?entity=20` — lists AR invoices. Tries `POST /services/core/query`
  first (one call, chosen fields); if that errors it falls back to
  `GET /objects/accounts-receivable/invoice` (which returns `key`/`id`/`href` only) plus one
  detail `GET` per record. The page shows which path was used and any query-service error, so
  a wrong field name is visible instead of silent.

Verified live against the imp company: 10 invoices at the top level, 8 in entity 20, 2 in
entity 30, 0 in entity 10 — all currently the app's own CSV imports (`description` of
`Innergy Export`, customer `C-00005`).

`lib/sage.ts` holds the whole client. Intacct errors are surfaced with their full
`ia::error.details[]` text (not truncated), since that text is what makes a failure
diagnosable.

### Auth: pasted token today, two real options later

The registered app in the Sage App Registry uses the **user-facing authorization-code
workflow** (a Vercel URL is its redirect URI), and no Web Services user exists yet — so
`client_credentials` cannot mint a token: it fails with
`"The username format is invalid (expected user@company)"`, and there is no user to name.

So `SAGE_ACCESS_TOKEN` is the current mode: mint a token by hand (the Sage Postman collection,
logging in against `ciderpresswoodworks-imp`) and paste it in. **Tokens live 12 hours**; when
one expires the app says so explicitly instead of retrying a mint that can't work. Client
credentials stays implemented as the second mode, used whenever `SAGE_ACCESS_TOKEN` is blank.

To get off hand-pasted tokens, pick one:

- **Authorization-code flow** (matches the app as registered) — add `/api/sage/auth/start` +
  `/callback`, a "Connect to Intacct" button, and token storage. Needs the exact redirect URI
  from the developer portal, plus a localhost one registered for dev.
- **Client credentials** (no browser login, required for unattended posting) — create a Web
  Services user (Company → Admin → Web Services Users), then pair the `client_id` with that
  user ID under Company → Setup → Company → Edit → Security → **Authorized Client
  Applications** (case-sensitive). Lindsey (RKL) flagged this as the eventual way to get
  fine-grained permissions.

### Query service conventions (verified live against the imp company, 2026-08)

The REST API is not fully RESTful: object list endpoints return `key`/`id`/`href` only, so
`POST /services/core/query` does nearly all the work.

- **Entity scoping uses `X-IA-API-Param-Entity`.** Verified: entity `10` → 0 invoices, `20` → 8,
  `30` → 2, no header → all 10. The header name `Sage-Param-Entity` is **accepted and silently
  ignored** (every value returns the full top-level set), so getting it wrong looks like
  success. Entity is per request on this tab — top level / 10 / 20 / 30 — defaulting to
  `SAGE_ENTITY_ID`.
- `caseSensitiveComparison` and `includePrivate` must sit inside **`filterParameters`**. At the
  top level the API rejects the payload: `"Unrecognized key includePrivate in query payload"`.
- `start` is **1-indexed**; `size` defaults to 100, max 4000 — always set it.
- Date-only fields (`invoiceDate`, `dueDate`) are `YYYY-MM-DD`; date-time fields use ISO 8601
  UTC. `audit.modifiedDateTime` is the field to filter on for recently changed records.

**AR invoice fields** (from `GET /services/core/model?name=accounts-receivable/invoice`, which
enumerates every queryable field on any object — use it instead of guessing):
`invoiceNumber`, `invoiceDate`, `dueDate`, `state`, `referenceNumber`, `description`,
`documentId`, `totalTxnAmount`, `totalTxnAmountDue`, `totalBaseAmount`, `totalBaseAmountDue`,
plus `key`/`id`. Two traps:

- The amount fields are `totalTxnAmount` / `totalTxnAmount**Due**` — there is no
  `totalDueTxnAmount`. Amounts come back as **strings**.
- `customer` is a **ref**, not a scalar, so it is absent from the model's field list. Pull it
  with dot notation (`customer.id`, `customer.name`); the response returns flat **dotted keys**,
  which is why `normalizeSageInvoice()` reads both dotted and nested shapes.

`SAGE_INVOICE_QUERY_FIELDS` + `normalizeSageInvoice()` remain the only two places to touch if a
field name changes.

> Security: the app has **no authentication** and is on a public Vercel URL. Read-only Sage
> calls are the same risk class as the existing Innergy proxy, but before the POST path lands,
> an unauthenticated route that writes into Sage needs a gate in front of it.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework auto-detected as Next.js).
2. Set the env vars from the table above as Project → Settings → Environment Variables.
   The four `AUTH_*` vars are required — **without `AUTH_SECRET` every page 500s**, so add
   them before the first deploy of the auth gate, not after.
3. Add the production callback to the Azure app registration:
   `https://<app>.vercel.app/api/auth/callback/microsoft-entra-id`. Microsoft only validates
   `redirect_uri` *after* the user enters credentials, so a missing one cannot be detected by
   probing — it shows up as a failed login.
4. Deploy, then smoke-test: an unauthenticated `GET /` should 307 to `/login` and every
   `/api/*` route should return 401 JSON.

**Verified on production (2026-08-04):** `/`, `/invoices`, `/sage` redirect to `/login`;
`/api/invoices`, `/api/purchase-orders`, `/api/sage/*` all return 401; and
`/api/auth/signin/microsoft-entra-id` redirects to the CPW tenant with the correct client id
and production callback.

`SAGE_ACCESS_TOKEN` is set on Production, Preview and Development, so the Sage tab works on
the live URL — but **a pasted token dies every 12 hours**, so expect the tab to start erroring
until a fresh token is pasted into Vercel. That's the cost of the interim auth mode; the
authorization-code flow (or a Web Services user for client credentials) is what removes it.

> Access is controlled by Microsoft sign-in — see the section below. Vercel's own deployment
> protection cannot cover production on this plan (the API returns
> `428 invalid_sso_protection`), which is why the gate lives in the app.
>
> API keys are never exposed to the browser — Innergy and Sage credentials are used
> server-side only.
