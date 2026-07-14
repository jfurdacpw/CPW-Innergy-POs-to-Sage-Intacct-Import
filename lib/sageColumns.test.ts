import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAGE_HEADERS,
  buildBillRow,
  NormalizedPurchaseOrder,
} from "./sageColumns";

/**
 * Reference header row extracted verbatim from row 1 of the Sage Intacct template
 * "Accounts Payable bills.xls". This is intentionally an independent copy so the test
 * fails loudly if SAGE_HEADERS ever drifts from the template.
 */
const REFERENCE_HEADERS = [
  "DONOTIMPORT", "BATCH_TITLE", "BILL_NO", "PO_NO", "VENDOR_ID", "PAYTO",
  "RETURNTO", "POSTING_DATE", "CREATED_DATE", "DUE_DATE", "TOTAL_DUE",
  "TOTAL_PAID", "PAID_DATE", "TERM_NAME", "DESCRIPTION", "BASECURR", "CURRENCY",
  "EXCH_RATE_DATE", "EXCH_RATE_TYPE_ID", "EXCHANGE_RATE", "LINE_NO", "MEMO",
  "ACCT_NO", "ACCT_LABEL", "LOCATION_ID", "DEPT_ID", "AMOUNT", "ALLOCATION_ID",
  "APBILLITEM_APACCOUNT", "ACTION", "SUPDOCID", "BILLABLE", "BILLED",
  "NAMEOFACQUIREDASSET", "SELECTEDASSETMODE", "ASSETQUANTITY",
  "INCLUDETAXINASSETCOST", "CLASSIFICATIONID", "AMORTIZATIONTEMPLATEID",
  "AMORTIZATIONSTARTDATE", "AMORTIZATIONENDDATE", "INVOICE_TYPE", "INVOICE_MODE",
  "APBILLITEM_CLASSID", "APBILLITEM_CUSTOMERID", "APBILLITEM_VENDORID",
  "APBILLITEM_EMPLOYEEID", "APBILLITEM_ITEMID", "APBILLITEM_PROJECTID",
  "APBILLITEM_WAREHOUSEID", "APBILLITEM_ASSETID", "APBILLITEM_CONTRACTID",
];

test("SAGE_HEADERS matches the template exactly (order + names)", () => {
  assert.equal(SAGE_HEADERS.length, 52);
  assert.deepEqual([...SAGE_HEADERS], REFERENCE_HEADERS);
});

test("buildBillRow maps PO fields to the correct columns", () => {
  const po: NormalizedPurchaseOrder = {
    id: "abc",
    poNumber: "PO-1042",
    vendorExternalId: "V-500",
    vendorName: "Acme Lumber",
    vendorContact: "Jane Doe",
    paymentTerms: "Net 30",
    receivedTotalCost: 1234.5,
    isReconciled: true,
    status: "Reconciled",
  };

  const row = buildBillRow(po, {
    batchTitle: "Innergy PO PO-1042 2026-07-02",
    exportDate: new Date(2026, 6, 2), // 2026-07-02 (local)
  });

  const col = (name: string) => row[SAGE_HEADERS.indexOf(name as any)];

  assert.equal(row.length, 52);
  assert.equal(col("BATCH_TITLE"), "Innergy PO PO-1042 2026-07-02");
  assert.equal(col("BILL_NO"), "PO-1042");
  assert.equal(col("PO_NO"), "PO-1042");
  assert.equal(col("VENDOR_ID"), "V-500");
  assert.equal(col("PAYTO"), "Jane Doe");
  assert.equal(col("CREATED_DATE"), "07/02/2026");
  assert.equal(col("EXCH_RATE_DATE"), "07/02/2026");
  assert.equal(col("TOTAL_DUE"), "1234.50");
  assert.equal(col("AMOUNT"), "1234.50");
  assert.equal(col("TERM_NAME"), "Net 30");
  assert.equal(col("LINE_NO"), "1");
  assert.equal(col("MEMO"), "Innergy Export");
  assert.equal(col("ACCT_NO"), "60200");
  assert.equal(col("ACTION"), "Submit");
  // Unmapped columns are blank.
  assert.equal(col("RETURNTO"), "");
  assert.equal(col("DONOTIMPORT"), "");
});
