/**
 * Generic client-side .csv builder: a header row followed by data rows, written
 * as plain strings in exact column order (no key reordering / type coercion).
 * Shared by the bills (AP) and invoices (AR) exporters. Sage Intacct's importer
 * takes CSV, not .xlsx.
 */

/** Quote a CSV field if it contains a comma, quote, or newline; double up any quotes. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Build a CSV string from a header row + data rows (CRLF line endings). */
export function buildCsvString(
  headers: readonly string[],
  rows: string[][]
): string {
  const lines = [Array.from(headers), ...rows].map((row) =>
    row.map(csvEscape).join(",")
  );
  return lines.join("\r\n") + "\r\n";
}

/** Build a .csv Blob from a header row + data rows. */
export function buildCsvBlob(
  headers: readonly string[],
  rows: string[][]
): Blob {
  return new Blob([buildCsvString(headers, rows)], {
    type: "text/csv;charset=utf-8;",
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
