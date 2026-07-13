# CPW Innergy → Sage Intacct Exporter

Internal web app that lists records pulled live from Innergy and exports them to `.xlsx`
files matching Sage Intacct import templates. Two tabs:

- **Bills (AP)** — `/` — exports a **reconciled** purchase order to the **AP Bill** template
  (`Accounts Payable bills.xls`). One PO = one bill line.
- **Invoices (AR)** — `/invoices` — exports an invoice to the **AR Invoice** template
  (`Accounts Receivable invoices (Innergy Field Mapping).xls`). One invoice = one line;
  no status gate (any invoice can be exported).

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
| `INNERGY_API_KEY` | yes | Sent as the raw `Api-Key` header. Needs `Purchasing → PurchaseOrder → View`. |
| `INNERGY_BASE_URL` | no | Defaults to `https://app.innergy.com`. |

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

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework auto-detected as Next.js).
2. Add `INNERGY_API_KEY` (and optionally `INNERGY_BASE_URL`) as Project → Settings →
   Environment Variables.
3. Deploy, then smoke-test the live URL.

> Note: the app has **no authentication** — keep the URL internal. The Innergy key is only ever
> used server-side.
