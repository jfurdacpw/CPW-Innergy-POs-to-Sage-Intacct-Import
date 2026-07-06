/**
 * Client-side AR Invoice export. Builds a worksheet whose first row is the exact
 * AR_HEADERS and whose second row is the invoice line, then downloads it.
 */
import {
  AR_HEADERS,
  buildInvoiceRow,
  NormalizedInvoice,
  BuildInvoiceRowOptions,
} from "./arColumns";
import { buildSheetBlob, downloadBlob } from "./exportWorkbook";

/** Build an .xlsx Blob for one invoice (header row + a single data row). */
export function buildInvoiceWorkbookBlob(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): Blob {
  return buildSheetBlob(AR_HEADERS, [buildInvoiceRow(inv, opts)]);
}

/** Safe filename for an invoice export. */
export function invoiceExportFileName(inv: NormalizedInvoice): string {
  const safe = (inv.invoiceNumber || inv.id || "INV").replace(
    /[^A-Za-z0-9_-]+/g,
    "_"
  );
  return `AR_Invoice_${safe}.xlsx`;
}

/** Build the workbook and trigger a browser download. */
export function downloadInvoiceExport(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): void {
  downloadBlob(buildInvoiceWorkbookBlob(inv, opts), invoiceExportFileName(inv));
}
