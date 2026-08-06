/**
 * Innergy purchase order → Sage AP bill draft.
 *
 * The direct-API twin of the .csv path: `buildBillRow()` in lib/sageColumns.ts writes
 * the same PO into the 52-column AP Bill import template, and this module writes it
 * into the JSON body `POST /objects/accounts-payable/bill` expects. Both read the
 * same `NormalizedPurchaseOrder` and the **same constants** — account, memo, vendor
 * fallback, the PO-prefix rule — so the two paths cannot disagree about what the bill
 * is, only about transport. `lib/sageBillFromInnergy.test.ts` asserts that by building
 * both from one PO and comparing them field by field.
 *
 * One PO is one bill with one line, exactly as the .csv produces.
 */
import {
  BILL_ACTION,
  DEFAULT_ACCT_NO,
  EXPORT_MEMO,
  FALLBACK_VENDOR_ID,
  stripPoPrefix,
  type NormalizedPurchaseOrder,
} from "./sageColumns";
import type { SageBillDraft, SageBillLineDraft } from "./sageBillDraft";

/**
 * Account label for the expense line, if one is ever wanted.
 *
 * **Blank on purpose:** the .csv writes `ACCT_NO` with `ACCT_LABEL` empty, so the API
 * path names {@link DEFAULT_ACCT_NO} directly too. Unlike AR, that is not a
 * workaround — `glAccount` is a required field on an AP bill line.
 *
 * If Sage ever refuses it the way it refuses AR line accounts (the message covers
 * *"AP or AR account override"*), put a non-subtotal label id here and the line
 * becomes label-derived with no other change.
 */
export const AP_EXPENSE_ACCT_LABEL = "";

/**
 * `PAYTO` / `RETURNTO` are **deliberately not sent.**
 *
 * The .csv columns take a contact *name* (`VendorContactName` off the Innergy PO),
 * while the API's `contacts.payTo` / `contacts.returnTo` want a *ref* to a contact
 * record id. They are not the same value, and a blank ref is rejected outright. Sage
 * uses the vendor's own pay-to contact when the field is absent, which is what the
 * .csv import ends up doing for any name it cannot match.
 */
export const AP_CONTACTS_SENT = false;

/** Amounts go over the wire as strings, 2dp — same as the .csv AMOUNT column. */
function amountString(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface InnergyBillDraftOptions {
  /** `createdDate` (the .csv CREATED_DATE). Defaults to today, matching the export. */
  createdDate?: string;
  /**
   * What to do after the create. Defaults to `"submit"`, mirroring the .csv's
   * `ACTION = "Submit"` — see {@link SageBillDraft.action}.
   */
  action?: SageBillDraft["action"];
}

/** The single expense line: received total, account 60200, memo "Innergy Export". */
function expenseLine(po: NormalizedPurchaseOrder): SageBillLineDraft {
  return {
    txnAmount: amountString(po.receivedTotalCost),
    memo: EXPORT_MEMO,
    glAccountId: DEFAULT_ACCT_NO,
    accountLabelId: AP_EXPENSE_ACCT_LABEL,
    // LOCATION_ID and DEPT_ID are blank on the .csv AP export and stay blank here.
    // The AR constants (20-PA / FURNITURE) are deliberately not shared with AP —
    // borrowing them would give one PO different GL detail through the two routes.
    // Both fields are editable in the dialog if Sage turns out to require location.
    departmentId: "",
    locationId: "",
    projectId: "",
  };
}

/**
 * Build the draft for one purchase order — the same one-line bill the .csv export
 * produces, as JSON.
 */
export function sageDraftFromInnergyPO(
  po: NormalizedPurchaseOrder,
  opts: InnergyBillDraftOptions = {}
): SageBillDraft {
  return {
    billNumber: stripPoPrefix(po.poNumber),
    vendorId: po.vendorExternalId || FALLBACK_VENDOR_ID,
    createdDate: opts.createdDate || today(),
    // POSTING_DATE is blank on the .csv; Sage posts on the created date.
    postingDate: "",
    // DUE_DATE is blank on the .csv too — Sage derives it from the term. See
    // SageBillDraft.dueDate for why this is not filled in with a guess.
    dueDate: "",
    termId: po.paymentTerms,
    referenceNumber: po.poNumber,
    // DESCRIPTION is blank on the .csv; the line memo carries "Innergy Export".
    description: "",
    currency: "USD",
    action: opts.action || (BILL_ACTION === "Submit" ? "submit" : "draft"),
    lines: [expenseLine(po)],
  };
}

/**
 * Whether this PO would post with the fallback vendor — the AP counterpart of the
 * AR fallback-customer warning. True when Innergy has no External Id on the vendor,
 * in which case the bill lands on {@link FALLBACK_VENDOR_ID} rather than the real one.
 */
export function innergyPOUsesFallbackVendor(po: NormalizedPurchaseOrder): boolean {
  return !po.vendorExternalId;
}
