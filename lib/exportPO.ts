/**
 * Client-side AP Bill export. Builds a worksheet whose first row is the exact
 * SAGE_HEADERS and whose second row is the PO's bill line, then downloads it.
 */
import {
  SAGE_HEADERS,
  buildBillRow,
  NormalizedPurchaseOrder,
  BuildRowOptions,
} from "./sageColumns";
import { buildSheetBlob, downloadBlob } from "./exportWorkbook";

/** Build an .xlsx Blob for one PO (header row + a single data row). */
export function buildWorkbookBlob(
  po: NormalizedPurchaseOrder,
  opts: BuildRowOptions
): Blob {
  return buildSheetBlob(SAGE_HEADERS, [buildBillRow(po, opts)]);
}

/** Safe filename for a PO export. */
export function exportFileName(po: NormalizedPurchaseOrder): string {
  const safePo = (po.poNumber || po.id || "PO").replace(/[^A-Za-z0-9_-]+/g, "_");
  return `AP_Bill_${safePo}.xlsx`;
}

/** Build the workbook and trigger a browser download. */
export function downloadPOExport(
  po: NormalizedPurchaseOrder,
  opts: BuildRowOptions
): void {
  downloadBlob(buildWorkbookBlob(po, opts), exportFileName(po));
}
