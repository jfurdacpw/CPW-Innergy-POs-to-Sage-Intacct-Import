# CPW Innergy → Sage Intacct Exporter

Internal web app that lists records pulled live from Innergy and gets them into Sage
Intacct — either as a `.csv` import file or straight through the REST API. Three tabs:

- **Bills (AP)** — `/` — two routes for the same **reconciled** purchase order: **Post to Sage**
  sends it through the API, **Export .csv** writes the **AP Bill** template
  (`Accounts Payable bills.xls`). One PO = one bill with one line.
- **Invoices (AR)** — `/invoices` — two routes for the same invoice: **Post to Sage** sends it
  through the API, **Export .csv** writes the **AR Invoice** template
  (`Accounts Receivable invoices (Innergy Field Mapping).xls`). No status gate.
- **Sage API (test)** — `/sage` — the API workbench: connection test, list AR invoices out of
  Sage, and clone or hand-enter one.

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
| `SAGE_CLIENT_ID` | Sage tab | From the Sage App Registry entry for this app. |
| `SAGE_CLIENT_SECRET` | Sage tab | Never leaves the server. |
| `SAGE_WS_USER` | Sage tab | `userId@companyId`, e.g. `someUser@ciderpresswoodworks-imp`. **The `@` switches the app to self-minted tokens** — see below. |
| `SAGE_ACCESS_TOKEN` | fallback | Hand-minted token (Postman), used only while `SAGE_WS_USER` has no `@`. Lasts 12h. |
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
| ACCT_NO | `60200` (see below) |
| ACTION | `Submit` |

All other columns are exported blank. The exported file contains **only the header row + data
rows** (the template's `#` comment rows are omitted; Sage ignores them anyway).

Tunable constants live at the top of `lib/sageColumns.ts`: `DEFAULT_ACCT_NO` (`60200` since
commit `e046bba`; the template's row 2 had flagged the original `32000` as "Accounts Payable?
Will this change?"), `EXPORT_MEMO`, `BILL_ACTION`. **The API path reads the same constants** —
see below.

### Post to Sage: the same PO, through the API

**Post to Sage** on each row is the direct-API twin of Export .csv.
`lib/sageBillFromInnergy.ts` maps a `NormalizedPurchaseOrder` into a `SageBillDraft`
(`lib/sageBillDraft.ts`), and `app/components/PostBillDialog.tsx` opens with every field
editable and the exact JSON viewable before sending. Both routes go through the same
re-fetch-and-re-check-reconciled gate, so the API is not an easier way to send a PO the `.csv`
would refuse.

The mapper reads the **same constants as `lib/sageColumns.ts`** — `DEFAULT_ACCT_NO`,
`EXPORT_MEMO`, `BILL_ACTION`, `FALLBACK_VENDOR_ID`, `stripPoPrefix` — so the two transports
cannot disagree about what the bill is. `lib/sageBillFromInnergy.test.ts` asserts it by building
both the draft and the `.csv` row from one PO and comparing them column by column.

| `.csv` column | payload field |
|---|---|
| BILL_NO | `billNumber` (PO number, `PO-` stripped) |
| PO_NO | `referenceNumber` |
| VENDOR_ID | `vendor.id` |
| CREATED_DATE | `createdDate` (`YYYY-MM-DD`, not `MM/DD/YYYY`) |
| TERM_NAME | `term.id` |
| AMOUNT | `lines[].txnAmount` |
| MEMO | `lines[].memo` |
| ACCT_NO | `lines[].glAccount.id` |
| ACCT_LABEL | `lines[].accountLabel.id` (blank on both paths) |
| DEPT_ID / LOCATION_ID | `lines[].dimensions.department` / `.location` (blank on both paths) |
| ACTION `Submit` | a second call — see below |
| DUE_DATE / POSTING_DATE / DESCRIPTION | blank on both paths, so **omitted** from the payload |
| TOTAL_DUE | none — Sage sums the lines |
| BATCH_TITLE | none — batches are a `.csv` concept |
| PAYTO / RETURNTO | none — see below |

Four things worth knowing:

- **`ACTION = "Submit"` is a workflow call, not a field.** The bill is created (Sage's own
  default state, `draft`), then `POST /workflows/accounts-payable/bill/submit` runs with its key.
  `state` is not writable on create — the AR path proved that with *"State must be draft or not
  included in the request"* — and the reference says state cannot be PATCHed either. If the
  submit fails the create is **not** rolled back or hidden: the response carries the bill key
  plus `submitted: false` and the reason, because a draft nobody has the key for is worse.
- **`DUE_DATE` stays blank on purpose.** The `.csv` leaves the column empty and lets Sage compute
  the date from `TERM_NAME`; filling it with the created date would quietly turn Net 30 into
  due-on-receipt and change the aging. The REST reference lists `dueDate` as required, so if a
  create is rejected for a missing due date, the dialog's field is where one gets typed — the
  omission has not been exercised live yet.
- **`PAYTO` / `RETURNTO` are not sent.** The columns take a contact *name*
  (`VendorContactName`); `contacts.payTo` wants a ref to a contact record *id*. Different values,
  and a blank ref is rejected outright, so no `contacts` block is sent and Sage uses the vendor's
  own contact.
- **The line names its GL account, and that is normal here.** `glAccount` is required on an AP
  bill line, unlike an AR invoice line where naming an account is an override. If a bill does
  draw the GL-override refusal anyway — its wording covers *"AP or AR account override"* — the
  escape is the same as AR's: put a non-subtotal account label id in `AP_EXPENSE_ACCT_LABEL`
  (`lib/sageBillFromInnergy.ts`) and the account drops out of the payload.

**Not verified live.** No bill has been created through the API yet; the pasted
`SAGE_ACCESS_TOKEN` was expired and `SAGE_WS_USER` is still a bare company id, so even the
read-only probes (`GET /services/core/model?name=accounts-payable/bill-line`, and a query of the
lines on a `.csv`-imported bill) could not run. Those two reads are the cheap first step — they
confirm whether `accountLabel` is writable on a bill line and what dimension id formats real
imported bills carry, the same trick CLAUDE.md prescribes for invoice 40.

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
| ARINVOICEITEM_ARACCOUNT | **blank** — see below |
| ACCT_NO | **blank** revenue (`AR_REVENUE_ACCT_NO`); `33500` on the tax line |

`TERM_NAME`, `ACTION`, and all rev-rec / subtotal columns export blank (no Innergy
equivalent; `ACTION` blank → Sage defaults to Submit). The two AR GL accounts live in
`lib/arColumns.ts` and are deliberately **not** shared with the AP side:

- `ARINVOICEITEM_ARACCOUNT` — **exported blank, and always has been.** The column is in
  `AR_HEADERS` but has no entry in `COL`, so no exporter ever wrote to it; Sage derives the AR
  control account (12100, per RKL's IN-1002) from the customer. Worth knowing because naming it
  is an *override*: the API path sent it as `overrideOffsetGLAccount` and drew the
  "allow AP or AR account override" 422 partly for that reason. An earlier version of this file
  claimed the column was populated — it was not.
- `AR_REVENUE_ACCT_NO = "50200"` (Furniture Sales) with label
  `50200-Furniture Sales - Taxable`. It must never be the AP expense account (60200). 50200 assumes
  Furniture; the Millwork counterpart is still unresolved, which is the same open question as
  `DEPT_ID`.

**Sales tax:** taxable invoices export **two lines** — a pre-tax revenue line (line 1) and a
sales-tax line (line 2, `AMOUNT = InvoiceSalesTax`) posting to `AR_SALES_TAX_ACCT_NO` (`33500`,
from RKL's IN-1002 example). Untaxed invoices stay a single line. Tax is written as a plain GL
line, **not** via the template's `SUBTOTAL="T"` flag — that flag requires Account Labels, which
aren't mapped; the GL effect is identical (AR debit = revenue + tax). Verify against a Sage test
import, and confirm `33500` applies to all entities.

**Not yet mapped (needs setup in Innergy / a decision):** `DEPT_ID` (Furniture vs Millwork),
`LOCATION_ID` (entity/facility, e.g. `20-PA`), and `ARINVOICEITEM_PROJECTID` (Sage project IDs).
See the field-mapping reference for the full picture.

### Post to Sage: the same invoice, through the API

**Post to Sage** on each row is the direct-API twin of Export .csv. `lib/sageInvoiceFromInnergy.ts`
maps a `NormalizedInvoice` into the `SageInvoiceDraft` the API path already uses, then the shared
post dialog (`app/components/PostInvoiceDialog.tsx` — the same one the Sage tab uses for clones)
opens with every field editable and the exact JSON viewable before sending.

The mapper reads the **same constants as `lib/arColumns.ts`** — accounts, labels, department,
location, both fallbacks — so the two transports can never disagree about what the invoice is.
`lib/sageInvoiceFromInnergy.test.ts` asserts that directly: it builds both the draft and the
`.csv` rows from one invoice and compares amounts, accounts, location and project line by line.

| `.csv` column | draft field |
|---|---|
| INVOICE_NO | `invoiceNumber` |
| CUSTOMER_ID | `customerId` |
| CREATED_DATE | `invoiceDate` |
| DUE_DATE | `dueDate` |
| PO_NO (work order numbers) | `referenceNumber` |
| MEMO / DESCRIPTION | `description`, `lines[].memo` |
| AMOUNT | `lines[].txnAmount` |
| ACCT_LABEL / ACCT_NO | `lines[].accountLabelId` / `glAccountId` |
| ARINVOICEITEM_ARACCOUNT | `lines[].offsetGLAccountId` — blank on both paths |
| DEPT_ID / LOCATION_ID | `lines[].departmentId` / `locationId` |
| ARINVOICEITEM_PROJECTID | `lines[].projectId` |
| TOTAL_DUE | none — Sage sums the lines |
| BATCH_TITLE | none — batches are a `.csv` concept |

Two deliberate differences from the file path:

- **State defaults to `draft`, not `posted`.** Every Innergy customer's `ExternalIdentifier` is
  still null, so `customerId` falls back to `C-00005` (and the project to `TEST` with it).
  Posting that to the GL is worse than downloading a file someone reads first. The dialog says so
  and offers `posted`.
- **Taxed invoices are still blocked** — see the GL-override section below. Every live Innergy
  invoice is taxed (checked 2026-08-05: 1 of 1, `INV-26-100000`, tax 184.20), so until a
  non-subtotal `33500` label exists in Sage this path only covers untaxed invoices and the
  dialog warns before the POST instead of surfacing `AR-0148` after it. `Export .csv` is the
  route for taxed invoices in the meantime. When the label is created, put its exact id in
  `AR_SALES_TAX_ACCT_LABEL` (`lib/sageInvoiceFromInnergy.ts`) — the tax line then becomes
  label-derived like the revenue line and the block lifts with no other change.

The `.csv` path is **not** going away while that's true.

## Sage API (test) tab

`/sage` is the API workbench: prove the connection, read what's in Sage, and clone or hand-enter
an invoice. Pushing an *Innergy* invoice lives on the Invoices tab (above); this tab is where the
API behaviour gets verified.

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

### Auth: client credentials, with a pasted token as the fallback

`lib/sage.ts` picks its mode from the env, and **client credentials wins whenever it is
configured** — the app mints its own 12h tokens and re-mints a minute before expiry, so nothing
expires from under it and there is no token to store anywhere. That last part is why this beats
the authorization-code flow: this app has no database, and a rotating refresh token would need
one (with concurrent serverless refreshes racing to clobber it).

The switch is `SAGE_WS_USER` containing an `@`. A bare company id (which is all this var held
before a Web Services user existed) is rejected by Sage with
`"The username format is invalid (expected user@company)"`, so the `@` is what distinguishes a
real WS user from that placeholder. With no `@`, the app falls back to `SAGE_ACCESS_TOKEN`.

**One-time setup in Sage** (this is the whole fix for the daily re-pasting):

1. Company → Admin → **Web Services Users** → Add. Note the user id exactly — it is
   case-sensitive.
2. Give that user a role that can **create** AR invoices, not just view them. A permission-poor
   WS user mints a token perfectly happily and then fails on the actual call, which is why
   `checkSageConnection()` always follows the mint with a real object-model request rather than
   reporting success on the mint alone.
3. Company → Setup → Company → Edit → Security → **Authorized Client Applications** → Add:
   the `client_id` plus that user id.
4. Set `SAGE_WS_USER=<userId>@ciderpresswoodworks-imp` in `.env.local` and the Vercel env.
   `SAGE_ACCESS_TOKEN` can then be deleted — a stale value is ignored once the `@` is there.

**Order matters: steps 1–3 before step 4.** The `@` switches the app over immediately, so setting
the env var before the Authorized Client Applications pairing exists takes the Sage tab down —
including reads that work today — until the pairing is added. That's deliberate (a silent fallback
to the pasted token would hide a misconfiguration), but it means the env var goes last.

Verify with the Sage tab: **Auth mode** reads "Client credentials" and **Token expires** shows a
real timestamp (a pasted token has no known expiry, so it shows "unknown"). While the app is
still on a pasted token the tab says so, with these steps inline.

A token request that fails almost always means step 3 was skipped, the user id case is wrong, or
the `@companyId` half is missing — the thrown error names all three. Lindsey (RKL) flagged the
Web Services user as the eventual way to get fine-grained permissions anyway.

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

### Posting an invoice (write path)

Each row in the Sage invoice list has a **Clone** button, and the card header has **New
invoice**. Both open the same dialog — clone prefills every field from that invoice's detail
record, manual entry starts blank — and every field stays editable. `POST /api/sage/invoices`
then creates it.

- **The invoice number is cleared on a clone**, because Sage rejects a duplicate. Blank means
  Sage assigns the next number.
- **`state` is writable only as `"draft"`.** Verified live (2026-08-05) — sending `"posted"`,
  the value the object model lists and a read returns, is a 400:
  ```
  Payload contains errors | invalidParameter — Not a valid state
                          — "State must be draft or not included in the request."
  ```
  So "posted" is expressed by **omitting the field** and letting Sage apply its own default,
  which is what a .csv import with a blank `ACTION` does. `sageInvoicePayload()` does that
  translation; the dialog's State picker still reads posted/draft. `state` is the current field
  either way — the `action` field (`submit`/`draft`) is deprecated in the object model.
- The dialog can show **the exact JSON that will be sent** before sending. Both the preview and
  the server-side request come from `sageInvoicePayload()` in `lib/sageInvoiceDraft.ts`, so they
  cannot drift apart. That module is free of `server-only` imports for this reason.

Payload shape, verified against invoice 40 (a real CSV import) and the object models:

| Draft field | Sage payload |
|---|---|
| customer | `customer: { id }` |
| line amount / memo | `lines[].txnAmount`, `lines[].memo` — the only plain writable line fields |
| GL account | `lines[].glAccount: { id }` |
| AR control account | `lines[].overrideOffsetGLAccount: { id }` — editable, but **not sent** by the Innergy path: the .csv leaves `ARINVOICEITEM_ARACCOUNT` blank too, and an offset override is one of the two permissions the 422 asks for |
| account label | `lines[].accountLabel: { id }` e.g. `50200-Furniture Sales - Taxable` |
| dept / location / project | `lines[].dimensions.{department,location,project}: { id }` |

Empty ids are **omitted entirely** rather than sent as `{ "id": "" }`, which Sage rejects.
`lib/sageInvoiceDraft.test.ts` covers that, the two-line (revenue + sales tax) case, the
clone mapping, and validation.

#### Subtotal (sales tax) lines — and a trap in the detail endpoint

Each line has a **Type** of Entry / Subtotal / Tax, plus an **Add tax subtotal** button that
appends a 33500 / `Tax` row. Sage models this as `isSubtotal` on the invoice line, an enum of
`null` / `"subtotal"` / `"tax"`; a subtotal row lives in the invoice's **Subtotals** grid rather
than **Entries**. This is what RKL's manually-entered **IN-1002** does, and what the CSV
importer could never reproduce (every `SUBTOTAL="T"` variant either dropped the amount or
errored `AR-0148`).

Verified on IN-1002 (invoice key 24) — note the two different views of the same invoice:

| key | line | amount | isSubtotal | GL account | account label |
|---|---|---|---|---|---|
| 83 | 1 | 1300.00 | `null` | 50200 | `50200-Furniture Sales - Taxable` |
| 85 | 2 | 78.00 | `subtotal` | 33500 | `Tax` |

> **Trap:** `GET /objects/accounts-receivable/invoice/{key}` **omits subtotal rows** from its
> `lines` array. Invoice 24's detail returns only the 1300.00 line, even though the invoice
> totals 1378.00. Querying `accounts-receivable/invoice-line` returns both. So the clone path
> reads lines through `listSageInvoiceLines()` (the query service) — cloning from the detail
> record alone silently drops the tax and posts a short invoice. `dimensions.department.id`
> style dotted paths work in that query; the bare `department.id` form is rejected.

**Answered by live testing (2026-08-04): a subtotal row cannot be created through this API.**
Both routes were tried against the imp company; both are closed.

1. Sending the designation:
   ```
   REST-1050 IA.READ_ONLY_FIELD — "/lines/2/isSubtotal is a read-only field"
   ```
   `isSubtotal` is readable but not writable, and an AR invoice exposes **no subtotals
   collection** — the API's subtotal objects (`document-subtotal`, `document-line-subtotal`,
   `subtotal-template`) are all **Order Entry** and all **GET-only**.

2. Putting the subtotal account label on a line item instead:
   ```
   AR-0148 — "Choose or enter another account label. Subtotal account labels are not
              valid for line items."
   AR-0279 — "Currently, we cannot create the transaction"
   ```
   The identical wall the CSV importer hit in July, from the other side.

So the REST path lands exactly where the CSV path did, and the resolution is the same:
**a designated line posts as a plain GL line with no account label** (33500, label blank). The
code sends neither `isSubtotal` nor the subtotal label, and the dialog states this while any
line is designated. **GL effect is identical** — AR debit = revenue + tax.

Reading subtotals is unaffected, which is what keeps clones faithful (cloning IN-1002 reproduces
both lines and its 1378.00 total). A true Subtotals-grid row has to be entered in Sage by hand;
if that ever becomes a hard requirement, the untried avenues are the legacy XML API and an Order
Entry sales document with a subtotal template — ask RKL before building either.

#### GL account override: the API is more restricted than the CSV import

Naming a GL account on a line **is** a GL account override, and Sage refuses it for these API
calls:

```
AR-0279 — "Currently, we cannot create the transaction"
        — "You are trying to add data to Intacct that requires configuration changes or user
           permissions ... enable GL account override ... allow AP or AR account override"
```

The **.csv import route is allowed to do exactly this** — every CSV-imported invoice in the imp
company books tax as `gl 33500` with a blank label, and the earliest ones (33, 34) name 50200
with no label either. Same user, different door: the file import bypasses a restriction the REST
call is held to.

So `sageInvoicePayload()` avoids the override wherever it can: **when a line carries an account
label, the accounts are not sent at all**, since the label already implies them
(`50200-Furniture Sales - Taxable` → gl 50200, offset 12100). Accounts are sent only when there
is no label to derive them from — and `draftNeedsAccountOverride()` flags exactly that case, so
the dialog warns before posting instead of surfacing a 422.

That leaves tax lines genuinely blocked, because **every tax label in this company is a subtotal
label**, and those are invalid on line items:

| label | GL | offset | isSubtotal |
|---|---|---|---|
| `50200-Furniture Sales - Taxable` | 50200 | 12100 | false |
| `50300` / `50300NT` / `70540 Shop Supplies` | 50300 / 70540 | 12100 / – | false |
| `Subtotal` / `Tax` / `Tax-NY` / `Taxable` | 33500 / 33502 | 12100 | **true** |

Two ways to unblock a taxed invoice via the API, both configuration in Sage rather than code:

1. **Create a non-subtotal account label for 33500** (e.g. `33500-Sales Tax`, `isSubtotal` false)
   and use it on the tax line. No permission change, and it keeps every line label-derived.
2. **Enable GL account override** under Configure Accounts Receivable, or grant the user AR
   account override permission — which also makes raw-account lines work generally.

Option 1 is the narrower change. Until one of them is done, single-line (untaxed) invoices post
through the API and taxed ones do not.

> **Not yet exercised against live Sage.** The payload builder, clone mapping and subtotal
> designation are unit tested and modelled on real posted invoices, but no invoice has actually
> been created through this path yet — the first real Clone → Post is the test. Expect the
> response to surface any field Sage disagrees with verbatim, including `ia::error.details[]`.

> Security: every route that writes to Sage sits behind the Microsoft sign-in gate described at
> the top of this file — `middleware.ts` re-checks `lib/authAllowlist.ts` per request, so
> `POST /api/sage/invoices` is unreachable without a session cookie. A future unattended caller
> (a cron that posts invoices) needs its own machine-auth path; a cookie won't do.

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

`SAGE_ACCESS_TOKEN` is set on Production, Preview and Development. **A pasted token dies every 12
hours**, so while that is the active mode expect the Sage tab to start erroring until a fresh one
is pasted into Vercel. Setting `SAGE_WS_USER` to a Web Services user (`userId@companyId`) on all
three environments is what ends that — see the auth section above.

> Access is controlled by Microsoft sign-in — see the section below. Vercel's own deployment
> protection cannot cover production on this plan (the API returns
> `428 invalid_sso_protection`), which is why the gate lives in the app.
>
> API keys are never exposed to the browser — Innergy and Sage credentials are used
> server-side only.
