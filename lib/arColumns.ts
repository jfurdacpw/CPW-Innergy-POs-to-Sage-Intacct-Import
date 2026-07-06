/**
 * Sage Intacct AR Invoice import contract.
 *
 * The header row below must match the Sage Intacct "Accounts Receivable invoices"
 * import template EXACTLY, in order. The importer matches on these names.
 *
 * Source template: "Accounts Receivable invoices (Innergy Field Mapping).xls"
 */
import {
  formatDateMMDDYYYY,
  formatAmount,
  DEFAULT_ACCT_NO,
  EXPORT_MEMO,
} from "./sageColumns";

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
  /** Invoice amount -> TOTAL_DUE and AMOUNT. */
  invoiceAmount: number;
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
 * Build a single AR invoice line (one line per invoice) aligned to AR_HEADERS.
 * Every column not explicitly mapped is an empty string.
 *
 * Mapping decisions (confirmed with the user):
 * - PO_NO         <- Work Order number(s), comma-joined
 * - CUSTOMER_ID   <- customer External Id (blank until set in Innergy)
 * - DUE_DATE      <- Innergy DueDate (invoices carry a real due date; no terms field)
 * - TOTAL_DUE/AMOUNT <- InvoiceAmount
 * - ACCT_NO       <- 32000 (kept per the sheet)
 * - MEMO          <- "Innergy Export"
 * - ACTION        <- blank (the AR sheet marks it N/A; Sage defaults to Submit)
 * - TERM_NAME     <- blank (Innergy invoices have no payment-terms field)
 * - all rev-rec / SUBTOTAL / REVENUE_ACCOUNT columns <- blank (no Innergy match)
 */
export function buildInvoiceRow(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): string[] {
  const exportDate = opts.exportDate ?? new Date();
  const dateStr = formatDateMMDDYYYY(exportDate);
  const amount = formatAmount(inv.invoiceAmount);

  const values: Partial<Record<ArHeader, string>> = {
    BATCH_TITLE: opts.batchTitle,
    INVOICE_NO: inv.invoiceNumber,
    PO_NO: inv.workOrderNumbers.join(", "),
    CUSTOMER_ID: inv.customerExternalId,
    CREATED_DATE: dateStr,
    DUE_DATE: isoToMMDDYYYY(inv.dueDate),
    TOTAL_DUE: amount,
    EXCH_RATE_DATE: dateStr,
    LINE_NO: "1",
    MEMO: EXPORT_MEMO,
    ACCT_NO: DEFAULT_ACCT_NO,
    AMOUNT: amount,
  };

  return AR_HEADERS.map((h) => values[h] ?? "");
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
