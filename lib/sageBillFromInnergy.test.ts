import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILL_ACTION,
  DEFAULT_ACCT_NO,
  EXPORT_MEMO,
  FALLBACK_VENDOR_ID,
  SAGE_HEADERS,
  buildBillRow,
  type NormalizedPurchaseOrder,
} from "./sageColumns";
import {
  AP_EXPENSE_ACCT_LABEL,
  innergyPOUsesFallbackVendor,
  sageDraftFromInnergyPO,
} from "./sageBillFromInnergy";
import {
  billNeedsAccountOverride,
  sageBillPayload,
  validateSageBillDraft,
} from "./sageBillDraft";

function po(): NormalizedPurchaseOrder {
  return {
    id: "PO-100002",
    poNumber: "PO-100002",
    vendorExternalId: "V-00014",
    vendorName: "Acme Hardwoods",
    vendorContact: "Dana Reyes",
    paymentTerms: "Net 30",
    receivedTotalCost: 4231.5,
    isReconciled: true,
    status: "Reconciled",
    projectName: "P-26-1060",
  };
}

function noVendorIdPO(): NormalizedPurchaseOrder {
  return { ...po(), vendorExternalId: "", paymentTerms: "" };
}

/** Read a .csv cell by column name, so the assertions name the Sage column. */
function cell(row: string[], header: (typeof SAGE_HEADERS)[number]): string {
  return row[SAGE_HEADERS.indexOf(header)];
}

test("one PO is one bill with one line", () => {
  const draft = sageDraftFromInnergyPO(po(), { createdDate: "2026-08-06" });
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].txnAmount, "4231.50");
});

test("header fields map from the PO, dates land as YYYY-MM-DD", () => {
  const draft = sageDraftFromInnergyPO(po(), { createdDate: "2026-08-06" });

  // BILL_NO drops the "PO-" prefix; PO_NO (referenceNumber) keeps it.
  assert.equal(draft.billNumber, "100002");
  assert.equal(draft.referenceNumber, "PO-100002");
  assert.equal(draft.vendorId, "V-00014");
  assert.equal(draft.createdDate, "2026-08-06");
  assert.equal(draft.termId, "Net 30");
  assert.equal(draft.currency, "USD");
});

test("the draft carries the same values as the .csv row, column for column", () => {
  const subject = po();
  const draft = sageDraftFromInnergyPO(subject, { createdDate: "2026-08-06" });
  const row = buildBillRow(subject, {
    batchTitle: "Innergy PO PO-100002 2026-08-06",
    exportDate: new Date("2026-08-06T12:00:00Z"),
  });

  assert.equal(draft.billNumber, cell(row, "BILL_NO"));
  assert.equal(draft.referenceNumber, cell(row, "PO_NO"));
  assert.equal(draft.vendorId, cell(row, "VENDOR_ID"));
  assert.equal(draft.termId, cell(row, "TERM_NAME"));
  assert.equal(draft.lines[0].txnAmount, cell(row, "AMOUNT"));
  assert.equal(draft.lines[0].txnAmount, cell(row, "TOTAL_DUE"));
  assert.equal(draft.lines[0].memo, cell(row, "MEMO"));
  assert.equal(draft.lines[0].glAccountId, cell(row, "ACCT_NO"));
  assert.equal(draft.lines[0].accountLabelId, cell(row, "ACCT_LABEL"));
  assert.equal(draft.lines[0].departmentId, cell(row, "DEPT_ID"));
  assert.equal(draft.lines[0].locationId, cell(row, "LOCATION_ID"));

  // Same day, two formats: the .csv wants MM/DD/YYYY, the API wants YYYY-MM-DD.
  const [mm, dd, yyyy] = cell(row, "CREATED_DATE").split("/");
  assert.equal(draft.createdDate, `${yyyy}-${mm}-${dd}`);

  // Blank on the .csv, and blank here — Sage derives the due date from the term
  // and posts on the created date.
  assert.equal(cell(row, "DUE_DATE"), "");
  assert.equal(draft.dueDate, "");
  assert.equal(cell(row, "POSTING_DATE"), "");
  assert.equal(draft.postingDate, "");
  assert.equal(cell(row, "DESCRIPTION"), "");
  assert.equal(draft.description, "");
});

test("the line uses the shared AP constants, not the AR ones", () => {
  const draft = sageDraftFromInnergyPO(po());
  assert.equal(draft.lines[0].glAccountId, DEFAULT_ACCT_NO);
  assert.equal(draft.lines[0].memo, EXPORT_MEMO);
  assert.equal(draft.lines[0].accountLabelId, AP_EXPENSE_ACCT_LABEL);
  // The AR department/location (FURNITURE / 20-PA) must not leak onto a bill —
  // the .csv AP export leaves both blank.
  assert.equal(draft.lines[0].departmentId, "");
  assert.equal(draft.lines[0].locationId, "");
});

test("ACTION = Submit becomes the submit workflow, never a state on create", () => {
  assert.equal(BILL_ACTION, "Submit");
  assert.equal(sageDraftFromInnergyPO(po()).action, "submit");
  assert.equal(
    sageDraftFromInnergyPO(po(), { action: "draft" }).action,
    "draft"
  );
  // `state` is not writable on create (AR: "State must be draft or not included in
  // the request"), so the payload must never carry it.
  const payload = sageBillPayload(sageDraftFromInnergyPO(po())) as any;
  assert.equal("state" in payload, false);
});

test("no vendor external id falls back to SBD-00001, same as the .csv", () => {
  const subject = noVendorIdPO();
  const draft = sageDraftFromInnergyPO(subject);
  const row = buildBillRow(subject, { batchTitle: "x" });

  assert.equal(draft.vendorId, FALLBACK_VENDOR_ID);
  assert.equal(draft.vendorId, cell(row, "VENDOR_ID"));
  assert.equal(innergyPOUsesFallbackVendor(subject), true);
  assert.equal(innergyPOUsesFallbackVendor(po()), false);
});

test("blank values are omitted from the payload, never sent as empty refs", () => {
  const payload = sageBillPayload(
    sageDraftFromInnergyPO(noVendorIdPO(), { createdDate: "2026-08-06" })
  ) as any;

  // Sage rejects { "id": "" } — a PO with no payment term must simply not send one.
  assert.equal("term" in payload, false);
  assert.equal("dueDate" in payload, false);
  assert.equal("postingDate" in payload, false);
  assert.equal("description" in payload, false);
  assert.equal("dimensions" in payload.lines[0], false);
  // PAYTO / RETURNTO are contact names on the .csv and id refs on the API, so no
  // contacts block is sent at all.
  assert.equal("contacts" in payload, false);
});

test("the payload is the shape Sage documents for a bill", () => {
  const payload = sageBillPayload(
    sageDraftFromInnergyPO(po(), { createdDate: "2026-08-06" })
  ) as any;

  assert.deepEqual(payload, {
    billNumber: "100002",
    vendor: { id: "V-00014" },
    createdDate: "2026-08-06",
    term: { id: "Net 30" },
    referenceNumber: "PO-100002",
    currency: { txnCurrency: "USD" },
    lines: [
      {
        txnAmount: "4231.50",
        memo: EXPORT_MEMO,
        glAccount: { id: DEFAULT_ACCT_NO },
      },
    ],
  });
});

test("an account label, when one exists, replaces the named account", () => {
  const draft = sageDraftFromInnergyPO(po());
  draft.lines[0].accountLabelId = "60200-Materials";

  assert.equal(billNeedsAccountOverride(draft), false);
  const payload = sageBillPayload(draft) as any;
  assert.equal(payload.lines[0].accountLabel.id, "60200-Materials");
  assert.equal(payload.lines[0].glAccount, undefined);
});

test("an Innergy PO passes validation as built", () => {
  assert.deepEqual(validateSageBillDraft(sageDraftFromInnergyPO(po())), []);
  // A zero-cost PO is caught before the POST rather than by Sage.
  assert.equal(
    validateSageBillDraft(
      sageDraftFromInnergyPO({ ...po(), receivedTotalCost: 0 })
    ).length,
    1
  );
});
