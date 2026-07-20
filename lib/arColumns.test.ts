import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AR_HEADERS,
  buildInvoiceRow,
  buildInvoiceRows,
  isoToMMDDYYYY,
  NormalizedInvoice,
} from "./arColumns";

/**
 * Reference header row matching Sage's own official "Accounts Receivable
 * invoices.xls" template (downloaded directly from Sage, 2026-07-20), trimmed
 * to the columns this exporter populates. Independent copy so the test fails
 * loudly if AR_HEADERS ever drifts. Note column 5 has no header name (a
 * customer-name sanity-check column, not a real Sage field) — but unlike an
 * earlier RKL-edited sample, ACCT_LABEL appears only once, after ACCT_NO,
 * matching Sage's real template order.
 */
const REFERENCE_HEADERS = [
  "DONOTIMPORT", "BATCH_TITLE", "INVOICE_NO", "PO_NO", "CUSTOMER_ID",
  "", "POSTING_DATE", "CREATED_DATE", "DUE_DATE", "TOTAL_DUE",
  "TERM_NAME", "DESCRIPTION", "BASECURR", "CURRENCY",
  "EXCH_RATE_DATE", "EXCH_RATE_TYPE_ID", "EXCHANGE_RATE", "LINE_NO", "MEMO",
  "ACCT_NO", "ACCT_LABEL", "LOCATION_ID", "DEPT_ID",
  "ALLOCATION_ID", "AMOUNT", "SUBTOTAL", "REVREC_TEMPLATE",
  "REVREC_STARTDATE", "DEFERREDREV_ACCOUNT", "REVREC_JOURNAL",
  "REVREC_SCHEDULE_LINE_NO", "REVENUE_ACCOUNT", "REVREC_POSTINGDATE",
  "REVREC_AMOUNT", "ARINVOICEITEM_ARACCOUNT", "ACTION", "SUPDOCID",
  "BILLTO", "SHIPTO", "REVREC_ENDDATE", "ARINVOICEITEM_PROJECTID",
  "ARINVOICEITEM_CUSTOMERID", "ARINVOICEITEM_VENDORID",
  "ARINVOICEITEM_EMPLOYEEID", "ARINVOICEITEM_CLASSID",
];

test("AR_HEADERS matches Sage's official template exactly (order + names)", () => {
  assert.equal(AR_HEADERS.length, 45);
  assert.deepEqual([...AR_HEADERS], REFERENCE_HEADERS);
});

test("isoToMMDDYYYY converts and rejects bad input", () => {
  assert.equal(isoToMMDDYYYY("2026-08-10"), "08/10/2026");
  assert.equal(isoToMMDDYYYY("2026-08-10T00:00:00Z"), "08/10/2026");
  assert.equal(isoToMMDDYYYY(""), "");
  assert.equal(isoToMMDDYYYY("not-a-date"), "");
});

test("buildInvoiceRow maps invoice fields to the correct columns", () => {
  const inv: NormalizedInvoice = {
    id: "INV-26-100000",
    invoiceNumber: "INV-26-100000",
    customerName: "RW Guild",
    customerExternalId: "", // blank until set in Innergy
    projectName: "RW Stockholm Test",
    projectNumber: "P-26-1060",
    workOrderNumbers: ["P-26-1060-002p", "P-26-1060-003p"],
    invoiceAmount: 3070.02,
    dueDate: "2026-08-10",
    status: "Pending",
  };

  const row = buildInvoiceRow(inv, {
    batchTitle: "Innergy INV INV-26-100000 2026-07-06",
    exportDate: new Date(2026, 6, 6), // 2026-07-06 (local)
  });

  const col = (name: string) => row[AR_HEADERS.indexOf(name as any)];

  assert.equal(row.length, 45);
  assert.equal(col("BATCH_TITLE"), "Innergy INV INV-26-100000 2026-07-06");
  assert.equal(col("INVOICE_NO"), "INV-26-100000");
  assert.equal(col("PO_NO"), "P-26-1060-002p, P-26-1060-003p");
  // Falls back to FALLBACK_CUSTOMER_ID when Innergy has no External Id set.
  assert.equal(col("CUSTOMER_ID"), "C-00005");
  assert.equal(row[5], "RW Guild"); // sanity-check customer name column
  assert.equal(col("POSTING_DATE"), "07/06/2026");
  assert.equal(col("CREATED_DATE"), "07/06/2026");
  assert.equal(col("DUE_DATE"), "08/10/2026");
  assert.equal(col("TOTAL_DUE"), "3070.02");
  assert.equal(col("AMOUNT"), "3070.02");
  assert.equal(col("LINE_NO"), "1");
  assert.equal(col("MEMO"), "Innergy Export");
  assert.equal(col("DESCRIPTION"), "Innergy Export");
  assert.equal(col("ACCT_NO"), "50200");
  assert.equal(col("ACCT_LABEL"), "50200-Furniture Sales - Taxable");
  assert.equal(col("LOCATION_ID"), "20-PA");
  assert.equal(col("DEPT_ID"), "FURNITURE");
  // Falls back to FALLBACK_PROJECT_NUMBER ("TEST") when falling back to
  // FALLBACK_CUSTOMER_ID: the invoice's real project belongs to a different
  // customer than the fallback, which Sage rejects (CORE-1255) — but "TEST"
  // belongs to the fallback customer itself (Mary Kay's confirmed GL
  // screenshot, 2026-07-20), so it's safe to use here instead of blank.
  assert.equal(col("ARINVOICEITEM_PROJECTID"), "TEST");
  assert.equal(col("ARINVOICEITEM_ARACCOUNT"), "");
  assert.equal(col("TERM_NAME"), "");
  assert.equal(col("ACTION"), "");
  assert.equal(col("REVENUE_ACCOUNT"), "");
  assert.equal(col("SUBTOTAL"), "");
  assert.equal(col("DONOTIMPORT"), "");
});

test("buildInvoiceRow sets ARINVOICEITEM_PROJECTID when the customer has a real External Id", () => {
  const inv: NormalizedInvoice = {
    id: "INV-26-100005",
    invoiceNumber: "INV-26-100005",
    customerName: "Sullivan",
    customerExternalId: "C-00005",
    projectNumber: "P-26-2000",
    workOrderNumbers: [],
    invoiceAmount: 500,
    dueDate: "2026-08-10",
    status: "Pending",
  };

  const row = buildInvoiceRow(inv, { batchTitle: "b" });
  const col = (name: string) => row[AR_HEADERS.indexOf(name as any)];

  assert.equal(col("CUSTOMER_ID"), "C-00005");
  assert.equal(col("ARINVOICEITEM_PROJECTID"), "P-26-2000");
});

const taxableInvoice: NormalizedInvoice = {
  id: "INV-26-100001",
  invoiceNumber: "INV-26-100001",
  customerName: "Sullivan",
  customerExternalId: "C-00005",
  workOrderNumbers: ["P-26-1060-002p"],
  invoiceAmount: 1378, // total incl. tax
  preTaxAmount: 1300,
  salesTax: 78,
  dueDate: "2026-07-19",
  status: "Pending",
};

test("buildInvoiceRows splits sales tax onto a second line", () => {
  const rows = buildInvoiceRows(taxableInvoice, {
    batchTitle: "b",
    exportDate: new Date(2026, 6, 6),
  });
  const col = (r: string[], name: string) => r[AR_HEADERS.indexOf(name as any)];

  assert.equal(rows.length, 2);
  // Revenue line: pre-tax amount, revenue account, line 1.
  assert.equal(col(rows[0], "LINE_NO"), "1");
  assert.equal(col(rows[0], "AMOUNT"), "1300.00");
  assert.equal(col(rows[0], "ACCT_NO"), "50200");
  assert.equal(col(rows[0], "ACCT_LABEL"), "50200-Furniture Sales - Taxable");
  // Tax line: tax amount to 33500, line 2 — header/date fields stay blank.
  // ACCT_LABEL and SUBTOTAL both stay blank: three separate live-import
  // attempts (2026-07-20) confirmed there's no combination that both shows a
  // label and preserves the tax amount. See buildTaxRow's comment.
  assert.equal(col(rows[1], "LINE_NO"), "2");
  assert.equal(col(rows[1], "AMOUNT"), "78.00");
  assert.equal(col(rows[1], "ACCT_NO"), "33500");
  assert.equal(col(rows[1], "ACCT_LABEL"), "");
  assert.equal(col(rows[1], "MEMO"), "Sales Tax");
  assert.equal(col(rows[1], "DESCRIPTION"), "Sales Tax");
  assert.equal(col(rows[1], "SUBTOTAL"), "");
  assert.equal(col(rows[1], "INVOICE_NO"), "");
  assert.equal(col(rows[1], "CUSTOMER_ID"), "");
  assert.equal(col(rows[1], "TOTAL_DUE"), "");
  assert.equal(col(rows[1], "DEPT_ID"), "");
  assert.equal(col(rows[1], "LOCATION_ID"), "20-PA");
  // Tax line gets ARINVOICEITEM_PROJECTID too, matching the revenue line —
  // RKL (Mary Kay) confirmed Sage dropped the tax line entirely until the
  // Project column was populated on the import (email, 2026-07-20).
  assert.equal(col(rows[1], "ARINVOICEITEM_PROJECTID"), "");
});

test("buildInvoiceRows sets ARINVOICEITEM_PROJECTID on the tax line too, when the customer has a real External Id", () => {
  const rows = buildInvoiceRows(
    { ...taxableInvoice, projectNumber: "P-26-2000" },
    { batchTitle: "b", exportDate: new Date(2026, 6, 6) }
  );
  const col = (r: string[], name: string) => r[AR_HEADERS.indexOf(name as any)];

  assert.equal(col(rows[0], "ARINVOICEITEM_PROJECTID"), "P-26-2000");
  assert.equal(col(rows[1], "ARINVOICEITEM_PROJECTID"), "P-26-2000");
});

test("buildInvoiceRows uses FALLBACK_PROJECT_NUMBER on both lines when the customer has no External Id", () => {
  const rows = buildInvoiceRows(
    { ...taxableInvoice, customerExternalId: "", projectNumber: "P-26-2000" },
    { batchTitle: "b", exportDate: new Date(2026, 6, 6) }
  );
  const col = (r: string[], name: string) => r[AR_HEADERS.indexOf(name as any)];

  // Real project (P-26-2000) is ignored here — it belongs to a different
  // customer than the FALLBACK_CUSTOMER_ID this invoice's CUSTOMER_ID falls
  // back to, so using it would hit CORE-1255. "TEST" belongs to the fallback
  // customer itself (Mary Kay's confirmed GL screenshot, 2026-07-20).
  assert.equal(col(rows[0], "CUSTOMER_ID"), "C-00005");
  assert.equal(col(rows[0], "ARINVOICEITEM_PROJECTID"), "TEST");
  assert.equal(col(rows[1], "ARINVOICEITEM_PROJECTID"), "TEST");
});

test("buildInvoiceRows is a single line when there is no tax", () => {
  const rows = buildInvoiceRows(
    { ...taxableInvoice, invoiceAmount: 1000, preTaxAmount: 1000, salesTax: 0 },
    { batchTitle: "b" }
  );
  assert.equal(rows.length, 1);
});

test("golden: matches the confirmed-good row-for-row (INV-26-100000, with tax); tax line's ACCT_LABEL has no valid value at all", () => {
  const inv: NormalizedInvoice = {
    id: "INV-26-100000",
    invoiceNumber: "INV-26-100000",
    customerName: "TEST",
    customerExternalId: "C-00005",
    projectNumber: "TEST",
    workOrderNumbers: [],
    invoiceAmount: 3254.22,
    preTaxAmount: 3070.02,
    salesTax: 184.2,
    dueDate: "2026-08-05",
    status: "Pending",
  };

  const rows = buildInvoiceRows(inv, {
    batchTitle: "Innergy INV INV-26-100000 2026-07-14",
    exportDate: new Date(2026, 6, 14), // 07/14/2026
  });
  const col = (r: string[], name: string) => r[AR_HEADERS.indexOf(name as any)];

  assert.equal(rows.length, 2);

  assert.equal(col(rows[0], "BATCH_TITLE"), "Innergy INV INV-26-100000 2026-07-14");
  assert.equal(col(rows[0], "INVOICE_NO"), "INV-26-100000");
  assert.equal(col(rows[0], "CUSTOMER_ID"), "C-00005");
  assert.equal(col(rows[0], "POSTING_DATE"), "07/14/2026");
  assert.equal(col(rows[0], "CREATED_DATE"), "07/14/2026");
  assert.equal(col(rows[0], "DUE_DATE"), "08/05/2026");
  assert.equal(col(rows[0], "TOTAL_DUE"), "3254.22");
  assert.equal(col(rows[0], "LINE_NO"), "1");
  assert.equal(col(rows[0], "ACCT_LABEL"), "50200-Furniture Sales - Taxable");
  assert.equal(col(rows[0], "ACCT_NO"), "50200");
  assert.equal(col(rows[0], "LOCATION_ID"), "20-PA");
  assert.equal(col(rows[0], "DEPT_ID"), "FURNITURE");
  assert.equal(col(rows[0], "AMOUNT"), "3070.02");
  assert.equal(col(rows[0], "ARINVOICEITEM_PROJECTID"), "TEST");
  assert.equal(col(rows[0], "DESCRIPTION"), "Innergy Export");

  assert.equal(col(rows[1], "LINE_NO"), "2");
  assert.equal(col(rows[1], "ACCT_LABEL"), "");
  assert.equal(col(rows[1], "ACCT_NO"), "33500");
  assert.equal(col(rows[1], "LOCATION_ID"), "20-PA");
  assert.equal(col(rows[1], "AMOUNT"), "184.20");
  assert.equal(col(rows[1], "ARINVOICEITEM_PROJECTID"), "TEST");
  assert.equal(col(rows[1], "DESCRIPTION"), "Sales Tax");
  // ACCT_LABEL and SUBTOTAL both blank: no Entries-grid label represents tax,
  // and every SUBTOTAL="T" variant tried drops the AMOUNT. See buildTaxRow's
  // comment.
  assert.equal(col(rows[1], "SUBTOTAL"), "");
});
