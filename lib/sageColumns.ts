/**
 * Sage Intacct AP Bill import contract.
 *
 * The header row below must match the Sage Intacct "Accounts Payable bills" import
 * template EXACTLY, in order. Do not reorder, rename, add, or remove columns without
 * confirming against the template — the importer matches on these names.
 *
 * Source template: /Volumes/Projects-CPW-1/ADMIN/10 - IT/13 - INNERGY/Accounts Payable bills.xls
 */

export const SAGE_HEADERS = [
  "DONOTIMPORT",
  "BATCH_TITLE",
  "BILL_NO",
  "PO_NO",
  "VENDOR_ID",
  "PAYTO",
  "RETURNTO",
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
  "AMOUNT",
  "ALLOCATION_ID",
  "APBILLITEM_APACCOUNT",
  "ACTION",
  "SUPDOCID",
  "BILLABLE",
  "BILLED",
  "NAMEOFACQUIREDASSET",
  "SELECTEDASSETMODE",
  "ASSETQUANTITY",
  "INCLUDETAXINASSETCOST",
  "CLASSIFICATIONID",
  "AMORTIZATIONTEMPLATEID",
  "AMORTIZATIONSTARTDATE",
  "AMORTIZATIONENDDATE",
  "INVOICE_TYPE",
  "INVOICE_MODE",
  "APBILLITEM_CLASSID",
  "APBILLITEM_CUSTOMERID",
  "APBILLITEM_VENDORID",
  "APBILLITEM_EMPLOYEEID",
  "APBILLITEM_ITEMID",
  "APBILLITEM_PROJECTID",
  "APBILLITEM_WAREHOUSEID",
  "APBILLITEM_ASSETID",
  "APBILLITEM_CONTRACTID",
] as const;

export type SageHeader = (typeof SAGE_HEADERS)[number];

/**
 * The GL account number that bill lines post to.
 * — kept as a single constant so it's a one-line change if it moves.
 */
export const DEFAULT_ACCT_NO = "60200";

/** Constant memo written to every exported line. */
export const EXPORT_MEMO = "Innergy Export";

/** Transaction status. Template maps ACTION -> "Submit". */
export const BILL_ACTION = "Submit";

/**
 * Normalized purchase order shape the exporter consumes. The API route
 * (lib/innergy.ts) is responsible for mapping the raw Innergy response into this.
 */
export interface NormalizedPurchaseOrder {
  /** Innergy PO sequence id (used for the detail fetch). */
  id: string;
  /** Human PO number -> BILL_NO and PO_NO. */
  poNumber: string;
  /** Vendor's External Id -> VENDOR_ID. */
  vendorExternalId: string;
  /** Vendor display name (for the UI table). */
  vendorName: string;
  /** Vendor contact -> PAYTO. */
  vendorContact: string;
  /** Payment terms -> TERM_NAME. */
  paymentTerms: string;
  /** Received total cost -> TOTAL_DUE and AMOUNT. */
  receivedTotalCost: number;
  /** Whether the PO is reconciled (gate for export). */
  isReconciled: boolean;
  /** Raw status label (for the UI badge / debugging). */
  status: string;
  /** Project name/number for the UI table (optional). */
  projectName?: string;
}

/** Format a Date as MM/DD/YYYY (Sage-friendly). */
export function formatDateMMDDYYYY(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Format an amount as a plain decimal string; negatives get a leading dash (Sage rule). */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export interface BuildRowOptions {
  /** BATCH_TITLE value. Sage pre-pends "HISTORY - " on import. */
  batchTitle: string;
  /** Date used for CREATED_DATE and EXCH_RATE_DATE. Defaults to today. */
  exportDate?: Date;
}

/**
 * Build a single bill line (one line per PO) aligned to SAGE_HEADERS.
 * Returns an array of cell values in the exact header order; every column not
 * explicitly mapped is an empty string.
 */
export function buildBillRow(
  po: NormalizedPurchaseOrder,
  opts: BuildRowOptions
): string[] {
  const exportDate = opts.exportDate ?? new Date();
  const dateStr = formatDateMMDDYYYY(exportDate);
  const amount = formatAmount(po.receivedTotalCost);

  const values: Partial<Record<SageHeader, string>> = {
    BATCH_TITLE: opts.batchTitle,
    BILL_NO: po.poNumber,
    PO_NO: po.poNumber,
    VENDOR_ID: po.vendorExternalId,
    PAYTO: po.vendorContact,
    CREATED_DATE: dateStr,
    TOTAL_DUE: amount,
    TERM_NAME: po.paymentTerms,
    EXCH_RATE_DATE: dateStr,
    LINE_NO: "1",
    MEMO: EXPORT_MEMO,
    ACCT_NO: DEFAULT_ACCT_NO,
    AMOUNT: amount,
    ACTION: BILL_ACTION,
  };

  return SAGE_HEADERS.map((h) => values[h] ?? "");
}

/** Default batch title for a PO: "Innergy PO <PO#> <YYYY-MM-DD>". */
export function defaultBatchTitle(poNumber: string, date = new Date()): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
  return `Innergy PO ${poNumber} ${iso}`;
}
