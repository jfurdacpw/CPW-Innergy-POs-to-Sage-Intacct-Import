import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AR_DEPT_ID,
  AR_LOCATION_ID,
  AR_REVENUE_ACCT_LABEL,
  AR_SALES_TAX_ACCT_NO,
  FALLBACK_CUSTOMER_ID,
  FALLBACK_PROJECT_NUMBER,
  buildInvoiceRows,
  type NormalizedInvoice,
} from "./arColumns";
import {
  AR_CONTROL_ACCT_NO,
  AR_SALES_TAX_ACCT_LABEL,
  innergyInvoiceTaxIsBlocked,
  sageDraftFromInnergyInvoice,
} from "./sageInvoiceFromInnergy";
import { sageInvoicePayload, draftNeedsAccountOverride } from "./sageInvoiceDraft";

/** The one live Innergy invoice as of 2026-08-05 — taxed, no customer external id. */
function taxedInvoice(): NormalizedInvoice {
  return {
    id: "INV-26-100000",
    invoiceNumber: "INV-26-100000",
    customerName: "RW Guild",
    customerExternalId: "",
    projectName: "RW Guild Project",
    projectNumber: "P-26-1060",
    workOrderNumbers: ["WO-26-1060-001", "WO-26-1060-002"],
    invoiceAmount: 3254.22,
    preTaxAmount: 3070.02,
    salesTax: 184.2,
    dueDate: "2026-08-20",
    status: "Pending",
  };
}

function untaxedInvoice(): NormalizedInvoice {
  return {
    ...taxedInvoice(),
    invoiceNumber: "INV-26-100001",
    customerExternalId: "C-01234",
    invoiceAmount: 1000,
    preTaxAmount: 1000,
    salesTax: 0,
  };
}

test("a taxed invoice becomes a revenue line plus a sales-tax line", () => {
  const draft = sageDraftFromInnergyInvoice(taxedInvoice(), {
    invoiceDate: "2026-08-05",
  });

  assert.equal(draft.lines.length, 2);
  assert.equal(draft.lines[0].txnAmount, "3070.02");
  assert.equal(draft.lines[1].txnAmount, "184.20");
  // The two lines must add up to what Innergy calls the invoice total.
  const total = draft.lines.reduce((s, l) => s + parseFloat(l.txnAmount), 0);
  assert.equal(total.toFixed(2), "3254.22");
});

test("an untaxed invoice is a single line", () => {
  const draft = sageDraftFromInnergyInvoice(untaxedInvoice());
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].txnAmount, "1000.00");
  assert.equal(innergyInvoiceTaxIsBlocked(untaxedInvoice()), false);
});

test("header fields map from the invoice, dates land as YYYY-MM-DD", () => {
  const draft = sageDraftFromInnergyInvoice(
    { ...taxedInvoice(), dueDate: "2026-08-20T00:00:00Z" },
    { invoiceDate: "2026-08-05" }
  );

  assert.equal(draft.invoiceNumber, "INV-26-100000");
  assert.equal(draft.invoiceDate, "2026-08-05");
  assert.equal(draft.dueDate, "2026-08-20");
  assert.equal(draft.description, "Innergy Export");
  // PO_NO on the .csv side: the work order numbers, comma-joined.
  assert.equal(draft.referenceNumber, "WO-26-1060-001, WO-26-1060-002");
});

test("state defaults to draft, since the customer is a fallback", () => {
  assert.equal(sageDraftFromInnergyInvoice(taxedInvoice()).state, "draft");
  assert.equal(
    sageDraftFromInnergyInvoice(taxedInvoice(), { state: "posted" }).state,
    "posted"
  );
});

test("no customer external id falls back to C-00005 and its project", () => {
  const draft = sageDraftFromInnergyInvoice(taxedInvoice());
  assert.equal(draft.customerId, FALLBACK_CUSTOMER_ID);
  // Sage requires the project to belong to the header customer (CORE-1255), so a
  // fallback customer must take the fallback project, not the Innergy one.
  for (const line of draft.lines) {
    assert.equal(line.projectId, FALLBACK_PROJECT_NUMBER);
  }
});

test("a real customer external id carries its own project through", () => {
  const draft = sageDraftFromInnergyInvoice(untaxedInvoice());
  assert.equal(draft.customerId, "C-01234");
  assert.equal(draft.lines[0].projectId, "P-26-1060");
});

test("the revenue line is label-derived, so it asks for no GL override", () => {
  const draft = sageDraftFromInnergyInvoice(untaxedInvoice());
  const line = draft.lines[0];

  assert.equal(line.accountLabelId, AR_REVENUE_ACCT_LABEL);
  assert.equal(line.kind, "");
  assert.equal(line.departmentId, AR_DEPT_ID);
  assert.equal(line.locationId, AR_LOCATION_ID);
  assert.equal(draftNeedsAccountOverride(draft), false);

  // A label implies both accounts, so neither is sent — that is what keeps Sage
  // from refusing the call as a GL account override.
  const payload = sageInvoicePayload(draft) as any;
  assert.equal(payload.lines[0].accountLabel.id, AR_REVENUE_ACCT_LABEL);
  assert.equal(payload.lines[0].glAccount, undefined);
  assert.equal(payload.lines[0].overrideOffsetGLAccount, undefined);
});

test("the tax line names 33500 + 12100 and is flagged as blocked", () => {
  const inv = taxedInvoice();
  const draft = sageDraftFromInnergyInvoice(inv);
  const tax = draft.lines[1];

  assert.equal(tax.memo, "Sales Tax");
  assert.equal(tax.glAccountId, AR_SALES_TAX_ACCT_NO);
  assert.equal(tax.offsetGLAccountId, AR_CONTROL_ACCT_NO);

  // While no non-subtotal 33500 label exists the line must name the account, which
  // is the GL override Sage refuses — the UI has to warn instead of surprising us.
  if (!AR_SALES_TAX_ACCT_LABEL) {
    assert.equal(tax.kind, "tax");
    assert.equal(innergyInvoiceTaxIsBlocked(inv), true);
    assert.equal(draftNeedsAccountOverride(draft), true);
    // A designated line drops its label; the amount must survive regardless.
    const payload = sageInvoicePayload(draft) as any;
    assert.equal(payload.lines[1].accountLabel, undefined);
    assert.equal(payload.lines[1].txnAmount, "184.20");
    assert.equal(payload.lines[1].glAccount.id, AR_SALES_TAX_ACCT_NO);
  } else {
    // Once the label exists the line is an ordinary entry line and derives both
    // accounts from it, so nothing needs an override any more.
    assert.equal(tax.kind, "");
    assert.equal(innergyInvoiceTaxIsBlocked(inv), false);
    assert.equal(draftNeedsAccountOverride(draft), false);
  }
});

test("the API draft and the .csv rows agree on every shared value", () => {
  const inv = taxedInvoice();
  const draft = sageDraftFromInnergyInvoice(inv, { invoiceDate: "2026-08-05" });
  const rows = buildInvoiceRows(inv, {
    batchTitle: "test",
    exportDate: new Date("2026-08-05T12:00:00Z"),
  });

  // Same number of lines, same amounts, same accounts/dimensions per line — the
  // two transports must never disagree about what the invoice IS.
  assert.equal(rows.length, draft.lines.length);
  const COL = { ACCT_NO: 19, LOCATION_ID: 21, AMOUNT: 24, PROJECT: 40 };
  rows.forEach((row, i) => {
    assert.equal(row[COL.AMOUNT], draft.lines[i].txnAmount);
    assert.equal(row[COL.ACCT_NO], draft.lines[i].glAccountId);
    assert.equal(row[COL.LOCATION_ID], draft.lines[i].locationId);
    assert.equal(row[COL.PROJECT], draft.lines[i].projectId);
  });
  assert.equal(rows[0][2], draft.invoiceNumber);
  assert.equal(rows[0][4], draft.customerId);
  assert.equal(rows[0][8], "08/20/2026"); // DUE_DATE, same day as draft.dueDate
});
