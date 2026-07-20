/**
 * Sage Intacct AR Invoice import contract.
 *
 * The header row matches Sage's own official "Accounts Receivable invoices.xls"
 * template (downloaded directly from Sage, 2026-07-20), trimmed to the columns
 * this exporter actually populates — no blank sanity-check column, and a single
 * ACCT_NO/ACCT_LABEL pair (in that order), not the duplicated ACCT_LABEL an
 * earlier RKL-edited sample had. That duplicate doesn't exist in Sage's real
 * template and caused Sage to silently ignore the populated label (it read the
 * second, always-blank occurrence as "the" field) or hard-error with AR-0148 if
 * both were filled — confirmed via a live Sage test import, 2026-07-20.
 *
 * Because rows are built positionally by index, keep this header and COL in
 * sync with any future reordering.
 */
import { formatDateMMDDYYYY, formatAmount, EXPORT_MEMO } from "./sageColumns";

/** ACCT_NO for the revenue line (the credit) on non-tax invoice lines. */
export const AR_REVENUE_ACCT_NO = "50200";

/**
 * ACCT_LABEL for the revenue line. Must be the exact Sage account label
 * picklist entry for the "Entries" grid — confirmed via a live screenshot of
 * Sage's own Account Label dropdown (2026-07-20): the Entries picklist for
 * account 50200 is "50200-Furniture Sales - Taxable" (WITH the suffix). An
 * earlier fix removed the suffix based on a paraphrased description of a
 * different screenshot; this live dropdown enumeration is more authoritative.
 */
export const AR_REVENUE_ACCT_LABEL = "50200-Furniture Sales - Taxable";

/** Sales-tax liability account -> ACCT_NO on the separate tax line. */
export const AR_SALES_TAX_ACCT_NO = "33500";

/**
 * The tax line's ACCT_LABEL stays blank — confirmed (three separate live
 * Sage import tests, 2026-07-20) there's no combination that both shows a
 * label AND preserves the tax dollar amount:
 * - `ACCT_LABEL="Tax"` + `SUBTOTAL="T"` + `ACCT_NO` blank → tax AMOUNT
 *   dropped entirely on import (reproducing the "tax not included" bug RKL
 *   hit and fixed on 2026-07-17).
 * - `ACCT_LABEL="Tax"` + `SUBTOTAL` blank + real `ACCT_NO=33500` → hard error
 *   AR-0148 "Subtotal account labels are not valid for line items" (INV-26-100002).
 * - `ACCT_LABEL="Tax"` + `SUBTOTAL="T"` + real `ACCT_NO=33500` together
 *   (matching Mary Kay's manually-entered example exactly) → tax line
 *   silently dropped again, no Subtotal section rendered, no error at all
 *   (INV-26-100003).
 * "Tax" only exists in Sage's "Subtotal" grid picklist (live screenshot,
 * 2026-07-20), not the "Entries" grid's, and there is no Entries-grid
 * picklist value that represents tax at all. Getting this line's Account
 * Label to populate is a genuine CSV-import limitation, not something to
 * keep guessing at from our side — ask RKL/Sage support instead.
 */

/**
 * LOCATION_ID / DEPT_ID hardcoded per user request (2026-07-17) until Innergy
 * provides per-invoice location/department data. These WILL vary in the
 * future — revisit when that mapping exists.
 */
export const AR_LOCATION_ID = "20-PA";
export const AR_DEPT_ID = "FURNITURE";

/**
 * Fallback CUSTOMER_ID used when an invoice's customer has no External Id set
 * in Innergy yet. Remove once every customer has a real Sage Intacct customer
 * ID recorded there (matches the AP side's FALLBACK_VENDOR_ID pattern).
 */
export const FALLBACK_CUSTOMER_ID = "C-00005";

export const AR_HEADERS = [
  "DONOTIMPORT",
  "BATCH_TITLE",
  "INVOICE_NO",
  "PO_NO",
  "CUSTOMER_ID",
  "",
  "POSTING_DATE",
  "CREATED_DATE",
  "DUE_DATE",
  "TOTAL_DUE",
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
  "REVREC_ENDDATE",
  "ARINVOICEITEM_PROJECTID",
  "ARINVOICEITEM_CUSTOMERID",
  "ARINVOICEITEM_VENDORID",
  "ARINVOICEITEM_EMPLOYEEID",
  "ARINVOICEITEM_CLASSID",
] as const;

export type ArHeader = (typeof AR_HEADERS)[number];

/** Column indices, by position, matching AR_HEADERS above. */
const COL = {
  BATCH_TITLE: 1,
  INVOICE_NO: 2,
  PO_NO: 3,
  CUSTOMER_ID: 4,
  CUSTOMER_NAME_SANITY: 5,
  POSTING_DATE: 6,
  CREATED_DATE: 7,
  DUE_DATE: 8,
  TOTAL_DUE: 9,
  DESCRIPTION: 11,
  LINE_NO: 17,
  MEMO: 18,
  ACCT_NO: 19,
  ACCT_LABEL: 20,
  LOCATION_ID: 21,
  DEPT_ID: 22,
  AMOUNT: 24,
  SUBTOTAL: 25,
  ARINVOICEITEM_PROJECTID: 40,
} as const;

const ROW_LENGTH = AR_HEADERS.length;

/**
 * Normalized invoice shape the exporter consumes. The API route
 * (lib/innergy.ts) maps the raw Innergy invoice into this.
 */
export interface NormalizedInvoice {
  /** Innergy invoice number — used as the row key. */
  id: string;
  /** Invoice number -> INVOICE_NO. */
  invoiceNumber: string;
  /** Customer display name -> column 5 (sanity-check only, not a real Sage field). */
  customerName: string;
  /**
   * Customer's External Id -> CUSTOMER_ID. Blank until the Sage customer ID is
   * set on the customer's External Id field in Innergy (then it links by name).
   */
  customerExternalId: string;
  /** Project name (UI). */
  projectName?: string;
  /** Project number -> ARINVOICEITEM_PROJECTID. */
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
  /** Date used for POSTING_DATE/CREATED_DATE. Defaults to today. */
  exportDate?: Date;
}

/** Pre-tax revenue amount for the revenue line (falls back if Innergy omits it). */
function revenueAmount(inv: NormalizedInvoice): number {
  if (inv.preTaxAmount && inv.preTaxAmount > 0) return inv.preTaxAmount;
  const derived = inv.invoiceAmount - (inv.salesTax ?? 0);
  return derived > 0 ? derived : inv.invoiceAmount;
}

/**
 * Build the invoice's revenue line (LINE_NO 1). This is the only line that
 * carries the header-level fields (BATCH_TITLE, INVOICE_NO, CUSTOMER_ID,
 * dates, TOTAL_DUE) — matching the confirmed-working sample, where the
 * continuation line leaves those blank.
 */
export function buildInvoiceRow(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): string[] {
  const dateStr = formatDateMMDDYYYY(opts.exportDate ?? new Date());
  const row = new Array<string>(ROW_LENGTH).fill("");

  row[COL.BATCH_TITLE] = opts.batchTitle;
  row[COL.INVOICE_NO] = inv.invoiceNumber;
  row[COL.PO_NO] = inv.workOrderNumbers.join(", ");
  row[COL.CUSTOMER_ID] = inv.customerExternalId || FALLBACK_CUSTOMER_ID;
  row[COL.CUSTOMER_NAME_SANITY] = inv.customerName;
  row[COL.POSTING_DATE] = dateStr;
  row[COL.CREATED_DATE] = dateStr;
  row[COL.DUE_DATE] = isoToMMDDYYYY(inv.dueDate);
  row[COL.TOTAL_DUE] = formatAmount(inv.invoiceAmount);
  row[COL.LINE_NO] = "1";
  row[COL.MEMO] = EXPORT_MEMO;
  row[COL.DESCRIPTION] = EXPORT_MEMO;
  row[COL.ACCT_LABEL] = AR_REVENUE_ACCT_LABEL;
  row[COL.ACCT_NO] = AR_REVENUE_ACCT_NO;
  row[COL.LOCATION_ID] = AR_LOCATION_ID;
  row[COL.DEPT_ID] = AR_DEPT_ID;
  row[COL.AMOUNT] = formatAmount(revenueAmount(inv));
  // Only set when CUSTOMER_ID is the invoice's real customer: Sage requires the
  // project dimension to belong to (or be a child of) the header CUSTOMER_ID
  // (error CORE-1255). When customerExternalId is blank and CUSTOMER_ID falls
  // back to FALLBACK_CUSTOMER_ID, the real project belongs to a different
  // customer than the fallback, so it would always fail that check.
  row[COL.ARINVOICEITEM_PROJECTID] = inv.customerExternalId
    ? inv.projectNumber || ""
    : "";

  return row;
}

/**
 * Build the sales-tax continuation line (LINE_NO 2). Only line-level fields
 * are set — no INVOICE_NO/CUSTOMER_ID/dates/TOTAL_DUE.
 *
 * SUBTOTAL and ACCT_LABEL both stay blank; ACCT_NO is a real GL account
 * (33500) — this is the confirmed-good combination for correct dollar
 * posting (git tag `ar-import-confirmed-2026-07-20`), after three separate
 * live Sage import failures trying to get this line's Account Label to show
 * — see the comment above AR_SALES_TAX_ACCT_NO.
 *
 * ARINVOICEITEM_PROJECTID is set here too, mirroring the revenue line
 * (blank unless customerExternalId is a real, non-fallback match — see the
 * CORE-1255 comment on buildInvoiceRow). Mary Kay (RKL) confirmed via email
 * 2026-07-20 that Sage dropped the tax line entirely until the Project
 * column was populated on the import.
 */
function buildTaxRow(inv: NormalizedInvoice, tax: number): string[] {
  const row = new Array<string>(ROW_LENGTH).fill("");

  row[COL.LINE_NO] = "2";
  row[COL.MEMO] = "Sales Tax";
  row[COL.DESCRIPTION] = "Sales Tax";
  row[COL.ACCT_NO] = AR_SALES_TAX_ACCT_NO;
  row[COL.LOCATION_ID] = AR_LOCATION_ID;
  row[COL.AMOUNT] = formatAmount(tax);
  row[COL.ARINVOICEITEM_PROJECTID] = inv.customerExternalId
    ? inv.projectNumber || ""
    : "";

  return row;
}

/**
 * Build every line for the invoice: the pre-tax revenue line, plus a separate
 * sales-tax line when the invoice has tax. This is what the exporter writes.
 */
export function buildInvoiceRows(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): string[][] {
  const rows = [buildInvoiceRow(inv, opts)];
  const tax = inv.salesTax ?? 0;
  if (tax > 0.005) rows.push(buildTaxRow(inv, tax));
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
