import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankSageInvoiceDraft,
  sageInvoiceDraftFromDetail,
  sageInvoicePayload,
  validateSageInvoiceDraft,
  type SageInvoiceDraft,
} from "./sageInvoiceDraft";

/** A draft shaped like the real CSV-imported invoice 40 in the imp company. */
function sampleDraft(): SageInvoiceDraft {
  return {
    invoiceNumber: "INV-TEST-1",
    customerId: "C-00005",
    invoiceDate: "2026-07-20",
    dueDate: "2026-08-10",
    description: "Innergy Export",
    referenceNumber: "P-26-1060-002p",
    state: "posted",
    lines: [
      {
        txnAmount: "3070.02",
        memo: "Innergy Export",
        glAccountId: "50200",
        offsetGLAccountId: "12100",
        accountLabelId: "50200-Furniture Sales - Taxable",
        departmentId: "FURNITURE",
        locationId: "20-PA",
        projectId: "",
        kind: "",
      },
    ],
  };
}

test("payload nests refs and dimensions the way Sage expects", () => {
  const payload = sageInvoicePayload(sampleDraft()) as any;

  assert.deepEqual(payload.customer, { id: "C-00005" });
  assert.equal(payload.invoiceDate, "2026-07-20");
  assert.equal(payload.state, "posted");

  const line = payload.lines[0];
  assert.equal(line.txnAmount, "3070.02");
  assert.deepEqual(line.glAccount, { id: "50200" });
  // The AR control account rides on overrideOffsetGLAccount, not a top-level field.
  assert.deepEqual(line.overrideOffsetGLAccount, { id: "12100" });
  assert.deepEqual(line.accountLabel, { id: "50200-Furniture Sales - Taxable" });
  assert.deepEqual(line.dimensions, {
    department: { id: "FURNITURE" },
    location: { id: "20-PA" },
  });
  // An empty project must be absent, not { id: "" } — Sage rejects blank ref ids.
  assert.equal("project" in line.dimensions, false);
});

test("empty optional fields are omitted entirely", () => {
  const draft = sampleDraft();
  draft.invoiceNumber = "";
  draft.description = "";
  draft.referenceNumber = "";
  draft.lines[0].memo = "";
  draft.lines[0].accountLabelId = "";
  draft.lines[0].departmentId = "";
  draft.lines[0].locationId = "";

  const payload = sageInvoicePayload(draft) as any;
  for (const key of ["invoiceNumber", "description", "referenceNumber"]) {
    assert.equal(key in payload, false, `${key} should be omitted`);
  }
  const line = payload.lines[0];
  for (const key of ["memo", "accountLabel", "dimensions"]) {
    assert.equal(key in line, false, `${key} should be omitted`);
  }
});

test("a two-line invoice keeps both lines, tax line included", () => {
  const draft = sampleDraft();
  draft.lines.push({
    ...draft.lines[0],
    txnAmount: "184.20",
    memo: "Sales Tax",
    glAccountId: "33500",
  });

  const payload = sageInvoicePayload(draft) as any;
  assert.equal(payload.lines.length, 2);
  assert.deepEqual(payload.lines[1].glAccount, { id: "33500" });
  assert.equal(payload.lines[1].memo, "Sales Tax");
});

test("validation requires customer, dates and a non-zero amount per line", () => {
  assert.deepEqual(validateSageInvoiceDraft(sampleDraft()), []);

  const blank = blankSageInvoiceDraft();
  const problems = validateSageInvoiceDraft(blank);
  assert.ok(problems.some((p) => p.includes("Customer ID")));
  assert.ok(problems.some((p) => p.includes("Line 1")));
  // A blank draft still supplies both dates, so those must not be flagged.
  assert.equal(problems.some((p) => p.includes("Invoice date")), false);

  const zero = sampleDraft();
  zero.lines[0].txnAmount = "0";
  assert.ok(validateSageInvoiceDraft(zero).some((p) => p.includes("Line 1")));

  const nonNumeric = sampleDraft();
  nonNumeric.lines[0].txnAmount = "abc";
  assert.ok(validateSageInvoiceDraft(nonNumeric).some((p) => p.includes("Line 1")));
});

test("a clone reads accounts and dimensions out of a detail record", () => {
  // Trimmed copy of the real GET /objects/accounts-receivable/invoice/40 response.
  const detail = {
    invoiceNumber: "INV-MKC-26-100002",
    customer: { id: "C-00005", name: "TEST" },
    referenceNumber: "P-26-1060-002p",
    description: "Innergy Export",
    invoiceDate: "2026-07-20",
    dueDate: "2026-08-10",
    state: "posted",
    lines: [
      {
        txnAmount: "3070.02",
        memo: null,
        glAccount: { id: "50200", name: "Furniture Sales" },
        overrideOffsetGLAccount: { id: "12100" },
        accountLabel: { id: "50200-Furniture Sales - Taxable" },
        dimensions: {
          department: { id: "FURNITURE" },
          location: { id: "20-PA" },
          project: { id: null },
        },
      },
    ],
  };

  const draft = sageInvoiceDraftFromDetail(detail);
  assert.equal(draft.customerId, "C-00005");
  assert.equal(draft.referenceNumber, "P-26-1060-002p");
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].glAccountId, "50200");
  assert.equal(draft.lines[0].offsetGLAccountId, "12100");
  assert.equal(draft.lines[0].departmentId, "FURNITURE");
  assert.equal(draft.lines[0].locationId, "20-PA");
  assert.equal(draft.lines[0].projectId, "");
  // A cloned draft posts, matching what the CSV import produces.
  assert.equal(draft.state, "posted");
});

test("a detail record with no lines still yields one editable line", () => {
  const draft = sageInvoiceDraftFromDetail({ customer: { id: "C-1" } });
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].txnAmount, "");
});

test("an entry line sends no isSubtotal at all", () => {
  const payload = sageInvoicePayload(sampleDraft()) as any;
  assert.equal("isSubtotal" in payload.lines[0], false);
});

test("a designated subtotal line sends isSubtotal", () => {
  const draft = sampleDraft();
  draft.lines.push({
    ...draft.lines[0],
    txnAmount: "78.00",
    memo: "Sales Tax",
    glAccountId: "33500",
    accountLabelId: "Tax",
    kind: "subtotal",
  });

  const payload = sageInvoicePayload(draft) as any;
  assert.equal(payload.lines.length, 2);
  assert.equal("isSubtotal" in payload.lines[0], false);
  assert.equal(payload.lines[1].isSubtotal, "subtotal");
  assert.deepEqual(payload.lines[1].glAccount, { id: "33500" });
  assert.deepEqual(payload.lines[1].accountLabel, { id: "Tax" });
});

test("the tax designation is passed through distinctly from subtotal", () => {
  const draft = sampleDraft();
  draft.lines[0].kind = "tax";
  const payload = sageInvoicePayload(draft) as any;
  assert.equal(payload.lines[0].isSubtotal, "tax");
});

test("cloning from queried lines keeps the subtotal row the detail endpoint hides", () => {
  // GET /invoice/24 returns ONLY the 1300.00 entry line...
  const detail = {
    invoiceNumber: "IN-1002",
    customer: { id: "C-00005" },
    invoiceDate: "2026-07-09",
    dueDate: "2026-07-19",
    state: "posted",
    lines: [
      {
        txnAmount: "1300.00",
        glAccount: { id: "50200" },
        overrideOffsetGLAccount: { id: "12100" },
        accountLabel: { id: "50200-Furniture Sales - Taxable" },
        dimensions: { department: { id: "FURNITURE" }, location: { id: "20-PA" } },
      },
    ],
  };

  // ...while the invoice-line query returns both, with flat dotted keys.
  const queried = [
    {
      key: "83",
      lineNumber: 1,
      txnAmount: "1300.00",
      isSubtotal: null,
      "glAccount.id": "50200",
      "overrideOffsetGLAccount.id": "12100",
      "accountLabel.id": "50200-Furniture Sales - Taxable",
      "dimensions.department.id": "FURNITURE",
      "dimensions.location.id": "20-PA",
      "dimensions.project.id": "TEST",
    },
    {
      key: "85",
      lineNumber: 2,
      txnAmount: "78.00",
      isSubtotal: "subtotal",
      "glAccount.id": "33500",
      "overrideOffsetGLAccount.id": "12100",
      "accountLabel.id": "Tax",
      "dimensions.department.id": "FURNITURE",
      "dimensions.location.id": "20-PA",
      "dimensions.project.id": "TEST",
    },
  ];

  const withQuery = sageInvoiceDraftFromDetail(detail, queried);
  assert.equal(withQuery.lines.length, 2);
  assert.equal(withQuery.lines[1].txnAmount, "78.00");
  assert.equal(withQuery.lines[1].kind, "subtotal");
  assert.equal(withQuery.lines[1].glAccountId, "33500");
  assert.equal(withQuery.lines[1].accountLabelId, "Tax");
  assert.equal(withQuery.lines[0].projectId, "TEST");
  // Round-trip: cloning IN-1002 reproduces its 1378.00 total.
  const total = withQuery.lines.reduce((s, l) => s + parseFloat(l.txnAmount), 0);
  assert.equal(total.toFixed(2), "1378.00");

  // Without the queried lines, the tax row is lost — the bug this guards against.
  assert.equal(sageInvoiceDraftFromDetail(detail).lines.length, 1);
});
