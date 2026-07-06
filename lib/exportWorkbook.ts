/**
 * Generic client-side .xlsx builder: a header row followed by data rows, written
 * as plain strings in exact column order (no key reordering / type coercion).
 * Shared by the bills (AP) and invoices (AR) exporters.
 */
import * as XLSX from "xlsx";

/** Build an .xlsx Blob from a header row + data rows. */
export function buildSheetBlob(
  headers: readonly string[],
  rows: string[][]
): Blob {
  const aoa: string[][] = [Array.from(headers), ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
