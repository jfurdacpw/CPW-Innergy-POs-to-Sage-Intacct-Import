/**
 * Innergy invoice → Sage AR invoice draft.
 *
 * This is the direct-API twin of the .csv path: `buildInvoiceRows()` in
 * lib/arColumns.ts writes the same invoice into the 45-column import template,
 * and this module writes it into the JSON body `POST /objects/accounts-receivable/
 * invoice` expects. Both read the same `NormalizedInvoice` and the same account /
 * dimension / fallback constants, so the two paths cannot drift apart on values —
 * only on transport.
 *
 * Deliberately free of `server-only` imports: the post dialog builds this draft in
 * the browser and previews the exact JSON before anything is sent.
 *
 * Column → payload correspondence (see README for the full table):
 *
 * | .csv column                | draft field                          |
 * |----------------------------|--------------------------------------|
 * | INVOICE_NO                 | invoiceNumber                        |
 * | CUSTOMER_ID                | customerId                           |
 * | CREATED_DATE               | invoiceDate                          |
 * | DUE_DATE                   | dueDate                              |
 * | PO_NO (work order numbers) | referenceNumber                      |
 * | MEMO / DESCRIPTION         | description, lines[].memo            |
 * | AMOUNT                     | lines[].txnAmount                    |
 * | ACCT_LABEL                 | lines[].accountLabelId               |
 * | ACCT_NO                    | lines[].glAccountId                  |
 * | ARINVOICEITEM_ARACCOUNT    | lines[].offsetGLAccountId            |
 * | DEPT_ID / LOCATION_ID      | lines[].departmentId / locationId    |
 * | ARINVOICEITEM_PROJECTID    | lines[].projectId                    |
 * | TOTAL_DUE                  | (none — Sage sums the lines)         |
 * | BATCH_TITLE                | (none — batches are a .csv concept)  |
 */
import {
  AR_DEPT_ID,
  AR_LOCATION_ID,
  AR_REVENUE_ACCT_LABEL,
  AR_REVENUE_ACCT_NO,
  AR_SALES_TAX_ACCT_NO,
  FALLBACK_CUSTOMER_ID,
  resolveProjectId,
  revenueAmount,
  type NormalizedInvoice,
} from "./arColumns";
import { EXPORT_MEMO } from "./sageColumns";
import type { SageInvoiceDraft, SageInvoiceLineDraft } from "./sageInvoiceDraft";

/**
 * The AR control account (the debit) — Sage's `overrideOffsetGLAccount`, and the
 * `ARINVOICEITEM_ARACCOUNT` column on the .csv side.
 *
 * **Deliberately not sent.** `ARINVOICEITEM_ARACCOUNT` is present in `AR_HEADERS`
 * but has no entry in that module's `COL` map, so the confirmed-working .csv export
 * has never populated it — Sage derives the AR account from the customer on its own.
 * The field name says what sending it is: an offset **override**, which is exactly
 * the "allow AP or AR account override" permission Sage's 422 asks for. Matching the
 * .csv means naming at most one account per line rather than two.
 *
 * Kept as a named constant because it is the right value if an override ever is
 * permitted, and because it documents which account the .csv column refers to.
 */
export const AR_CONTROL_ACCT_NO = "12100";

/**
 * Account label for the sales-tax line, once one exists.
 *
 * **Blank on purpose, and this is the single blocker for taxed invoices.** Naming
 * account 33500 directly is a GL account override, which Sage refuses for API calls
 * (`AR-0279` "requires configuration changes or user permissions … enable GL account
 * override") even though the .csv importer is allowed to do exactly that. The usual
 * way out — put a label on the line so the accounts are derived rather than
 * overridden — is closed too, because **every** tax label in this company
 * (`Tax`, `Tax-NY`, `Subtotal`, `Taxable`) is a *subtotal* label, and those return
 * `AR-0148` "Subtotal account labels are not valid for line items".
 *
 * Fix, in Sage rather than here: create a **non-subtotal** account label for 33500
 * (e.g. `33500-Sales Tax`, offset 12100) and put its exact id in this constant. The
 * tax line then becomes label-derived like the revenue line and needs no override.
 *
 * While it is blank the tax line still gets built — with `kind: "tax"` and raw
 * accounts — so the dialog's own override warning fires and the amounts stay
 * visible/editable instead of the tax silently vanishing.
 */
export const AR_SALES_TAX_ACCT_LABEL = "";

/** Amounts go over the wire as strings, 2dp — same as the .csv AMOUNT column. */
function amountString(value: number): string {
  return value.toFixed(2);
}

/** Innergy dates can carry a time part; Sage date-only fields want `YYYY-MM-DD`. */
function isoDate(value: string): string {
  return (value || "").split("T")[0];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface InnergyDraftOptions {
  /**
   * `invoiceDate` (the .csv CREATED_DATE). Defaults to today, matching the export.
   */
  invoiceDate?: string;
  /**
   * Sage state. Defaults to **draft**: every Innergy customer's External Id is
   * still unset, so `customerId` falls back to {@link FALLBACK_CUSTOMER_ID} —
   * posting that straight to the GL is worse than downloading a file someone reads
   * first. The dialog offers `posted`.
   */
  state?: SageInvoiceDraft["state"];
}

/** The revenue line: pre-tax amount, label-derived accounts, full dimensions. */
function revenueLine(inv: NormalizedInvoice): SageInvoiceLineDraft {
  const label = AR_REVENUE_ACCT_LABEL;
  return {
    txnAmount: amountString(revenueAmount(inv)),
    memo: EXPORT_MEMO,
    // With a label present the payload builder omits the account entirely (the
    // label already implies it) and no GL override is requested. It is carried here
    // anyway so it shows in the dialog and still posts if the label is cleared.
    glAccountId: AR_REVENUE_ACCT_NO,
    // No AR offset — see AR_CONTROL_ACCT_NO.
    offsetGLAccountId: "",
    accountLabelId: label,
    departmentId: AR_DEPT_ID,
    locationId: AR_LOCATION_ID,
    projectId: resolveProjectId(inv),
    kind: "",
  };
}

/**
 * The sales-tax line. Mirrors `buildTaxRow()`: 33500, memo "Sales Tax", same
 * project/location as the revenue line.
 *
 * Always a plain **entry** line, never a designated subtotal/tax row. A real
 * Subtotals-grid row is not creatable through this API (see SageLineKind), the .csv
 * export gave up on the same thing in July, and the GL effect is identical either
 * way — so the Innergy path does not attempt it. The `kind` designation still exists
 * in the dialog for hand-entered invoices and stays faithful on read.
 */
function taxLine(inv: NormalizedInvoice, tax: number): SageInvoiceLineDraft {
  const label = AR_SALES_TAX_ACCT_LABEL;
  return {
    txnAmount: amountString(tax),
    memo: "Sales Tax",
    glAccountId: AR_SALES_TAX_ACCT_NO,
    // No AR offset — see AR_CONTROL_ACCT_NO. This line is the one that needs the
    // GL-account permission at all, so it must ask for as little as possible: one
    // account (33500), which is precisely what the .csv tax row carries.
    offsetGLAccountId: "",
    accountLabelId: label,
    // No department, matching buildTaxRow(): the .csv tax row sets LOCATION_ID and
    // the project but leaves DEPT_ID blank, and that exact combination is the one
    // confirmed to post correct dollars (tag ar-import-confirmed-2026-07-20). Sales
    // tax is a liability, not a departmental cost, so this is right on its own terms
    // too — but the reason to keep it identical is that the two paths must not
    // produce different GL detail from one invoice.
    departmentId: "",
    locationId: AR_LOCATION_ID,
    projectId: resolveProjectId(inv),
    kind: "",
  };
}

/**
 * Build the draft for one Innergy invoice: a pre-tax revenue line, plus a sales-tax
 * line when the invoice carries tax — the same one-or-two-line shape the .csv
 * export produces.
 */
export function sageDraftFromInnergyInvoice(
  inv: NormalizedInvoice,
  opts: InnergyDraftOptions = {}
): SageInvoiceDraft {
  const lines = [revenueLine(inv)];
  const tax = inv.salesTax ?? 0;
  if (tax > 0.005) lines.push(taxLine(inv, tax));

  return {
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerExternalId || FALLBACK_CUSTOMER_ID,
    invoiceDate: opts.invoiceDate || today(),
    dueDate: isoDate(inv.dueDate),
    description: EXPORT_MEMO,
    referenceNumber: inv.workOrderNumbers.join(", "),
    state: opts.state || "draft",
    lines,
  };
}

/**
 * Whether this invoice will hit the tax blocker described on
 * {@link AR_SALES_TAX_ACCT_LABEL}. Lets the UI say so before the POST instead of
 * surfacing `AR-0148` / `AR-0279` afterwards.
 */
export function innergyInvoiceTaxIsBlocked(inv: NormalizedInvoice): boolean {
  return (inv.salesTax ?? 0) > 0.005 && !AR_SALES_TAX_ACCT_LABEL;
}
