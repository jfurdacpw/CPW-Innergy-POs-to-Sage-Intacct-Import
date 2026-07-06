import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AR_HEADERS,
  buildInvoiceRow,
  isoToMMDDYYYY,
  NormalizedInvoice,
} from "./arColumns";

/**
 * Reference header row extracted verbatim from row 1 of the Sage Intacct template
 * "Accounts Receivable invoices (Innergy Field Mapping).xls". Independent copy so
 * the test fails loudly if AR_HEADERS ever drifts from the template.
 */
const REFERENCE_HEADERS = [
  "DONOTIMPORT", "BATCH_TITLE", "INVOICE_NO", "PO_NO", "CUSTOMER_ID",
  "POSTING_DATE", "CREATED_DATE", "DUE_DATE", "TOTAL_DUE", "TOTAL_PAID",
  "PAID_DATE", "TERM_NAME", "DESCRIPTION", "BASECURR", "CURRENCY",
  "EXCH_RATE_DATE", "EXCH_RATE_TYPE_ID", "EXCHANGE_RATE", "LINE_NO", "MEMO",
  "ACCT_NO", "ACCT_LABEL", "LOCATION_ID", "DEPT_ID", "ALLOCATION_ID", "AMOUNT",
  "SUBTOTAL", "REVREC_TEMPLATE", "REVREC_STARTDATE", "DEFERREDREV_ACCOUNT",
  "REVREC_JOURNAL", "REVREC_SCHEDULE_LINE_NO", "REVENUE_ACCOUNT",
  "REVREC_POSTINGDATE", "REVREC_AMOUNT", "ARINVOICEITEM_ARACCOUNT", "ACTION",
  "SUPDOCID", "BILLTO", "SHIPTO", "AMORTIZATIONTEMPLATEID",
  "AMORTIZATIONSTARTDATE", "AMORTIZATIONENDDATE", "REVREC_ENDDATE",
  "INVOICE_TYPE", "INVOICE_MODE", "ARINVOICEITEM_PROJECTID",
  "ARINVOICEITEM_CUSTOMERID", "ARINVOICEITEM_VENDORID",
  "ARINVOICEITEM_EMPLOYEEID", "ARINVOICEITEM_ITEMID", "ARINVOICEITEM_CLASSID",
  "ARINVOICEITEM_TASKID", "ARINVOICEITEM_COSTTYPEID",
];

test("AR_HEADERS matches the template exactly (order + names)", () => {
  assert.equal(AR_HEADERS.length, 54);
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

  assert.equal(row.length, 54);
  assert.equal(col("BATCH_TITLE"), "Innergy INV INV-26-100000 2026-07-06");
  assert.equal(col("INVOICE_NO"), "INV-26-100000");
  assert.equal(col("PO_NO"), "P-26-1060-002p, P-26-1060-003p");
  assert.equal(col("CUSTOMER_ID"), "");
  assert.equal(col("CREATED_DATE"), "07/06/2026");
  assert.equal(col("DUE_DATE"), "08/10/2026");
  assert.equal(col("EXCH_RATE_DATE"), "07/06/2026");
  assert.equal(col("TOTAL_DUE"), "3070.02");
  assert.equal(col("AMOUNT"), "3070.02");
  assert.equal(col("LINE_NO"), "1");
  assert.equal(col("MEMO"), "Innergy Export");
  assert.equal(col("ACCT_NO"), "32000");
  // Per the AR sheet, these stay blank.
  assert.equal(col("TERM_NAME"), "");
  assert.equal(col("ACTION"), "");
  assert.equal(col("REVENUE_ACCOUNT"), "");
  assert.equal(col("SUBTOTAL"), "");
  assert.equal(col("DONOTIMPORT"), "");
});
