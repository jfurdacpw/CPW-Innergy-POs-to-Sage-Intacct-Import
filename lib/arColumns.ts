/**
 * Sage Intacct AR Invoice import contract.
 *
 * The header row below must match the confirmed-working "SBDG AR Invoices Sample
 * Import" template EXACTLY, in order (46 columns) — including its blank column 5
 * and its two ACCT_LABEL columns (19 and 21; only 19 is ever populated). This
 * layout was verified by a successful Sage import of INV-26-100000 on 2026-07-17.
 *
 * Because column names alone don't uniquely identify a position (column 5 has no
 * name, and ACCT_LABEL appears twice), rows are built positionally by index
 * rather than through a name-keyed object.
 */
import { formatDateMMDDYYYY, formatAmount, EXPORT_MEMO } from "./sageColumns";

/** ACCT_NO for the revenue line (the credit) on non-tax invoice lines. */
export const AR_REVENUE_ACCT_NO = "50200";

/**
 * ACCT_LABEL for the revenue line. Must be the exact Sage account label
 * picklist entry — arbitrary text (e.g. just "50300" or "Taxable") fails with
 * AR-0148. Confirmed working value from the sample import.
 */
export const AR_REVENUE_ACCT_LABEL = "50200-Furniture Sales - Taxable";

/** Sales-tax liability account -> ACCT_NO on the separate tax line. */
export const AR_SALES_TAX_ACCT_NO = "33500";

/** ACCT_LABEL for the tax line — the picklist entry, confirmed working. */
export const AR_TAX_ACCT_LABEL = "Tax";

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
  "ACCT_LABEL",
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
  LINE_NO: 17,
  MEMO: 18,
  ACCT_LABEL: 19,
  ACCT_NO: 20,
  LOCATION_ID: 22,
  DEPT_ID: 23,
  AMOUNT: 25,
  SUBTOTAL: 26,
  ARINVOICEITEM_PROJECTID: 41,
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
  row[COL.ACCT_LABEL] = AR_REVENUE_ACCT_LABEL;
  row[COL.ACCT_NO] = AR_REVENUE_ACCT_NO;
  row[COL.LOCATION_ID] = AR_LOCATION_ID;
  row[COL.DEPT_ID] = AR_DEPT_ID;
  row[COL.AMOUNT] = formatAmount(revenueAmount(inv));
  row[COL.ARINVOICEITEM_PROJECTID] = inv.projectNumber || "";

  return row;
}

/**
 * Build the sales-tax continuation line (LINE_NO 2). Only line-level fields
 * are set — no INVOICE_NO/CUSTOMER_ID/dates/TOTAL_DUE — matching the
 * confirmed-working sample exactly.
 */
function buildTaxRow(tax: number): string[] {
  const row = new Array<string>(ROW_LENGTH).fill("");

  row[COL.LINE_NO] = "2";
  row[COL.ACCT_LABEL] = AR_TAX_ACCT_LABEL;
  row[COL.ACCT_NO] = AR_SALES_TAX_ACCT_NO;
  row[COL.LOCATION_ID] = AR_LOCATION_ID;
  row[COL.AMOUNT] = formatAmount(tax);
  row[COL.SUBTOTAL] = "T";

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
  if (tax > 0.005) rows.push(buildTaxRow(tax));
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
