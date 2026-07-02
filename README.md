# CPW Innergy PO → Sage Intacct AP Bill Exporter

Internal web app that lists purchase orders pulled live from Innergy and exports a
**reconciled** PO to an `.xlsx` file matching the Sage Intacct **AP Bill import** template
(`Accounts Payable bills.xls`). One PO = one bill line.

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

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework auto-detected as Next.js).
2. Add `INNERGY_API_KEY` (and optionally `INNERGY_BASE_URL`) as Project → Settings →
   Environment Variables.
3. Deploy, then smoke-test the live URL.

> Note: the app has **no authentication** — keep the URL internal. The Innergy key is only ever
> used server-side.
