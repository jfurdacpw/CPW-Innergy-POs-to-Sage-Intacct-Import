/**
 * Client-side AR Invoice export. Builds a CSV whose first row is the exact
 * AR_HEADERS and whose second row is the invoice line, then downloads it.
 */
import {
  AR_HEADERS,
  buildInvoiceRows,
  NormalizedInvoice,
  BuildInvoiceRowOptions,
} from "./arColumns";
import { buildCsvBlob, downloadBlob } from "./exportCsv";

/** Build a .csv Blob for one invoice (header row + one or more data rows). */
export function buildInvoiceCsvBlob(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): Blob {
  return buildCsvBlob(AR_HEADERS, buildInvoiceRows(inv, opts));
}

/** Safe filename for an invoice export. */
export function invoiceExportFileName(inv: NormalizedInvoice): string {
  const safe = (inv.invoiceNumber || inv.id || "INV").replace(
    /[^A-Za-z0-9_-]+/g,
    "_"
  );
  return `AR_Invoice_${safe}.csv`;
}

/** Build the CSV and trigger a browser download. */
export function downloadInvoiceExport(
  inv: NormalizedInvoice,
  opts: BuildInvoiceRowOptions
): void {
  downloadBlob(buildInvoiceCsvBlob(inv, opts), invoiceExportFileName(inv));
}
