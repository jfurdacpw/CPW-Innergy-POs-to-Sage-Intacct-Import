/**
 * Client-side Excel export. Builds a worksheet whose first row is the exact
 * SAGE_HEADERS and whose subsequent row(s) are PO data, then triggers a download.
 */
import * as XLSX from "xlsx";
import {
  SAGE_HEADERS,
  buildBillRow,
  NormalizedPurchaseOrder,
  BuildRowOptions,
} from "./sageColumns";

/** Build an .xlsx Blob for one PO (header row + a single data row). */
export function buildWorkbookBlob(
  po: NormalizedPurchaseOrder,
  opts: BuildRowOptions
): Blob {
  const dataRow = buildBillRow(po, opts);

  // Array-of-arrays keeps cells as plain strings in the exact column order —
  // no key reordering, no type coercion by the sheet writer.
  const aoa: string[][] = [Array.from(SAGE_HEADERS), dataRow];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
  const blob = buildWorkbookBlob(po, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(po);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
