/**
 * Sage Intacct AR Invoice import contract.
 *
 * The header row below must match the Sage Intacct "Accounts Receivable invoices"
 * import template EXACTLY, in order. The importer matches on these names.
 *
 * Source template: "Accounts Receivable invoices (Innergy Field Mapping).xls"
 */
import { formatDateMMDDYYYY, formatAmount, EXPORT_MEMO } from "./sageColumns";

/**
 * AR-specific GL accounts. These are deliberately NOT shared with the AP side:
 * an AR invoice must never post to the AP liability account (32000). The app
 * previously reused the AP `DEFAULT_ACCT_NO` here, which booked revenue into
 * accounts payable — see RKL meeting 2026-07-09.
 *
 * ARINVOICEITEM_ARACCOUNT is the AR control account (the debit).
 * Confirmed in the meeting: "AR account is 12,100".
 */
export const AR_CONTROL_ACCT_NO = "12100";

/** ACCT_NO for the revenue line (the credit) on non-tax invoice lines. */
export const AR_REVENUE_ACCT_NO = "60200";

/**
 * Sales-tax liability account -> ACCT_NO on the separate tax line. From RKL's
 * manual example (invoice IN-1002) sales tax posts to 33500 (PA Sales Taxes
 * Payable). VERIFY this is correct for all entities before importing real invoices.
 */
export const AR_SALES_TAX_ACCT_NO = "33500";

/**
 * Fallback CUSTOMER_ID used when an invoice's customer has no External Id set
 * in Innergy yet. Remove once every customer has a real Sage Intacct customer
 * ID recorded there (matches the AP side's FALLBACK_VENDOR_ID pattern).
 */
export const FALLBACK_CUSTOMER_ID = "C-00005";

/** ACCT_LABEL value for the sales-tax line — matches Sage's "Tax" account label. */
export const TAX_ACCT_LABEL = "Tax";

/** ACCT_LABEL value for the revenue (non-subtotal) line. */
export const REVENUE_ACCT_LABEL = "50300";

export const AR_HEADERS = [
  "DONOTIMPORT",
  "BATCH_TITLE",
  "INVOICE_NO",
  "PO_NO",
  "CUSTOMER_ID",
  "POSTING_DATE",
  "CREATED_DATE",
  "DUE_DATE",
  "TOTAL_DUE",
  "TOTAL_PAID",
  "PAID_DATE",
  "TERM_NAME",
  "DESCRIPTION",
  "BASECURR",
  "CURRENCY",
  "EXCH_RATE_DATE",
  "EXCH_RATE_TYPE_ID",
  "EXCHANGE_RATE",
  "LINE_NO",
  "MEMO",
  "ACCT_NO",
  "ACCT_LABEL",
  "LOCATION_ID",
  "DEPT_ID",
  "ALLOCATION_ID",
  "AMOUNT",
  "SUBTOTAL",
  "REVREC_TEMPLATE",
  "REVREC_STARTDATE",
  "DEFERREDREV_ACCOUNT",
  "REVREC_JOURNAL",
  "REVREC_SCHEDULE_LINE_NO",
  "REVENUE_ACCOUNT",
  "REVREC_POSTINGDATE",
  "REVREC_AMOUNT",
  "ARINVOICEITEM_ARACCOUNT",
  "ACTION",
  "SUPDOCID",
  "BILLTO",
  "SHIPTO",
  "AMORTIZATIONTEMPLATEID",
  "AMORTIZATIONSTARTDATE",
  "AMORTIZATIONENDDATE",
  "REVREC_ENDDATE",
  "INVOICE_TYPE",
  "INVOICE_MODE",
  "ARINVOICEITEM_PROJECTID",
  "ARINVOICEITEM_CUSTOMERID",
  "ARINVOICEITEM_VENDORID",
  "ARINVOICEITEM_EMPLOYEEID",
  "ARINVOICEITEM_ITEMID",
  "ARINVOICEITEM_CLASSID",
  "ARINVOICEITEM_TASKID",
  "ARINVOICEITEM_COSTTYPEID",
] as const;

export type ArHeader = (typeof AR_HEADERS)[number];

/**
 * Normalized invoice shape the exporter consumes. The API route
 * (lib/innergy.ts) maps the raw Innergy invoice into this.
 */
export interface NormalizedInvoice {
  /** Innergy invoice number — used as the row key. */
  id: string;
  /** Invoice number -> INVOICE_NO. */
  invoiceNumber: string;
  /** Customer display name (for the UI table). */
  customerName: string;
  /**
   * Customer's External Id -> CUSTOMER_ID. Blank until the Sage customer ID is
   * set on the customer's External Id field in Innergy (then it links by name).
   */
  customerExternalId: string;
  /** Project name (UI). */
  projectName?: string;
  /** Project number (UI). */
  projectNumber?: string;
  /** Work order number(s) -> PO_NO (Reference Number). */
  workOrderNumbers: string[];
  /** Invoice total incl. tax (Innergy InvoiceAmount) -> TOTAL_DUE. */
  invoiceAmount: number;
  /** Pre-tax amount (Innergy InvoicePreTaxAmount) -> revenue line AMOUNT. */
  preTaxAmount?: number;
  /** Sales tax (Innergy InvoiceSalesTax) -> a separate tax line when > 0. */
  salesTax?: number;
  /** Innergy DueDate (ISO YYYY-MM-DD) -> DUE_DATE. */
  dueDate: string;
  /** Raw status label (UI / debugging). */
  status: string;
}

/** Convert an ISO date (`YYYY-MM-DD`) to `MM/DD/YYYY`; empty string if unparseable. */
export function isoToMMDDYYYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

export interface BuildInvoiceRowOptions {
  /** BATCH_TITLE value. Sage pre-pends "HISTORY - " on import. */
  batchTitle: string;
  /** Date used for CREATED_DATE and EXCH_RATE_DATE. Defaults to today. */
  exportDate?: Date;
}

/**
 * Transaction-level values repeated on every line of the invoice.
 *
 * Mapping decisions:
 * - INVOICE_NO   <- invoice number
 * - PO_NO        <- Work Order number(s), comma-joined
 * - CUSTOMER_ID  <- customer External Id (blank until set in Innergy)
 * - DUE_DATE     <- Innergy DueDate; CREATED_DATE/EXCH_RATE_DATE <- export date
 * - TOTAL_DUE    <- InvoiceAmount (invoice total incl. tax)
 * - ARINVOICEITEM_ARACCOUNT <- 12100 (AR control account)
 * - TERM_NAME / ACTION / rev-rec columns <- blank (no Innergy equivalent)
 */
function invoiceHeaderValues(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): Partial<Record<ArHeader, string>> {
  const dateStr = formatDateMMDDYYYY(opts.exportDate ?? new Date());
  return {
    BATCH_TITLE: opts.batchTitle,
    INVOICE_NO: inv.invoiceNumber,
    PO_NO: inv.workOrderNumbers.join(", "),
    CUSTOMER_ID: inv.customerExternalId || FALLBACK_CUSTOMER_ID,
    CREATED_DATE: dateStr,
    DUE_DATE: isoToMMDDYYYY(inv.dueDate),
    TOTAL_DUE: formatAmount(inv.invoiceAmount),
    EXCH_RATE_DATE: dateStr,
    ARINVOICEITEM_ARACCOUNT: AR_CONTROL_ACCT_NO,
  };
}

/** Pre-tax revenue amount for the revenue line (falls back if Innergy omits it). */
function revenueAmount(inv: NormalizedInvoice): number {
  if (inv.preTaxAmount && inv.preTaxAmount > 0) return inv.preTaxAmount;
  const derived = inv.invoiceAmount - (inv.salesTax ?? 0);
  return derived > 0 ? derived : inv.invoiceAmount;
}

/**
 * Build the invoice's revenue line (LINE_NO 1) aligned to AR_HEADERS.
 * AMOUNT is the PRE-TAX revenue; ACCT_NO is the (pending) revenue account.
 * Sales tax, if any, goes on a separate line — see buildInvoiceRows.
 */
export function buildInvoiceRow(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): string[] {
  const values: Partial<Record<ArHeader, string>> = {
    ...invoiceHeaderValues(inv, opts),
    LINE_NO: "1",
    MEMO: EXPORT_MEMO,
    ACCT_NO: AR_REVENUE_ACCT_NO,
    ACCT_LABEL: REVENUE_ACCT_LABEL,
    AMOUNT: formatAmount(revenueAmount(inv)),
  };
  return AR_HEADERS.map((h) => values[h] ?? "");
}

/** Build the sales-tax line (LINE_NO 2) posting tax to AR_SALES_TAX_ACCT_NO. */
function buildTaxRow(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions,
  tax: number
): string[] {
  const values: Partial<Record<ArHeader, string>> = {
    ...invoiceHeaderValues(inv, opts),
    LINE_NO: "2",
    MEMO: "Sales Tax",
    ACCT_NO: AR_SALES_TAX_ACCT_NO,
    ACCT_LABEL: TAX_ACCT_LABEL,
    AMOUNT: formatAmount(tax),
  };
  return AR_HEADERS.map((h) => values[h] ?? "");
}

/**
 * Build every line for the invoice: the pre-tax revenue line, plus a separate
 * sales-tax line to AR_SALES_TAX_ACCT_NO when the invoice has tax. This is what
 * the exporter writes.
 *
 * Note: tax is posted as a plain GL line, NOT via the template's SUBTOTAL="T" flag —
 * that flag requires Account Labels, which aren't mapped. The GL effect is the same
 * (revenue pre-tax + tax to 33500; AR debit = the full total). Verify against a Sage
 * test import before relying on it for taxable invoices.
 */
export function buildInvoiceRows(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): string[][] {
  const rows = [buildInvoiceRow(inv, opts)];
  const tax = inv.salesTax ?? 0;
  if (tax > 0.005) rows.push(buildTaxRow(inv, opts, tax));
  return rows;
}

/** Default batch title for an invoice: "Innergy INV <number> <YYYY-MM-DD>". */
export function defaultInvoiceBatchTitle(
  invoiceNumber: string,
  date = new Date()
): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
  return `Innergy INV ${invoiceNumber} ${iso}`;
}
