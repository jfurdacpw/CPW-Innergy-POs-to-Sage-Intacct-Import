/**
 * Shape of an AP bill about to be POSTed to Sage, plus the pure helpers that build
 * and validate its payload.
 *
 * The AP twin of lib/sageInvoiceDraft.ts, and deliberately free of secrets and
 * `server-only` imports for the same reason: the post dialog builds and previews the
 * exact JSON in the browser that lib/sage.ts sends from the server, so the preview
 * cannot drift from the request.
 *
 * Field set taken from `POST /objects/accounts-payable/bill` (Sage Intacct REST API
 * v1). Unlike an AR invoice line, an AP bill line **requires** `glAccount` — naming
 * the expense account is the normal way to write a bill, not an override — so the
 * label/account choice here is an option rather than the workaround it is on the AR
 * side. See {@link billNeedsAccountOverride}.
 *
 * | .csv column (SAGE_HEADERS) | draft field                       |
 * |----------------------------|-----------------------------------|
 * | BILL_NO                    | billNumber                        |
 * | PO_NO                      | referenceNumber                   |
 * | VENDOR_ID                  | vendorId                          |
 * | CREATED_DATE               | createdDate                       |
 * | POSTING_DATE               | postingDate (blank on both paths) |
 * | DUE_DATE                   | dueDate (blank — Sage derives it) |
 * | TERM_NAME                  | termId                            |
 * | DESCRIPTION                | description (blank on both paths) |
 * | MEMO                       | lines[].memo                      |
 * | ACCT_NO / ACCT_LABEL       | lines[].glAccountId / accountLabelId |
 * | AMOUNT                     | lines[].txnAmount                 |
 * | LOCATION_ID / DEPT_ID      | lines[].locationId / departmentId |
 * | ACTION                     | action ("submit" / "draft")       |
 * | TOTAL_DUE                  | (none — Sage sums the lines)      |
 * | BATCH_TITLE                | (none — batches are a .csv concept) |
 */

export type SageBillLineDraft = {
  txnAmount: string;
  memo: string;
  glAccountId: string;
  /**
   * Optional. When set, the account is derived from the label and `glAccount` is
   * left out of the payload — the same trick the AR path uses to avoid asking for
   * the GL-account-override permission. The .csv AP export names the account with no
   * label, so this is blank by default.
   */
  accountLabelId: string;
  departmentId: string;
  locationId: string;
  projectId: string;
};

export type SageBillDraft = {
  billNumber: string;
  vendorId: string;
  /** `CREATED_DATE`, `YYYY-MM-DD`. Required by Sage. */
  createdDate: string;
  /** `POSTING_DATE`. Blank on the .csv path; Sage falls back to createdDate. */
  postingDate: string;
  /**
   * `DUE_DATE`. **Blank by default and that is deliberate** — the .csv leaves the
   * column empty and lets Sage compute the due date from `TERM_NAME`. Filling it in
   * with, say, the created date would silently turn Net 30 into due-on-receipt and
   * change the aging. The REST reference lists `dueDate` as required, so if Sage
   * rejects the omission the dialog's field is where a date gets typed.
   */
  dueDate: string;
  /** `TERM_NAME`, e.g. "Net 30". Sent as `term.id`. */
  termId: string;
  referenceNumber: string;
  description: string;
  /** `currency.txnCurrency`. USD everywhere here; kept a field so it is visible. */
  currency: string;
  /**
   * What happens after the bill is created — the `ACTION` column's equivalent.
   *
   * `"submit"` mirrors the .csv's `ACTION = "Submit"`: create, then call
   * `POST /workflows/accounts-payable/bill/submit`. It is a **second call**, not a
   * `state` on create — `state` is not writable on create (the AR path proved that:
   * *"State must be draft or not included in the request."*), and the reference says
   * plainly that state cannot be set by PATCH either, only by the workflow endpoints.
   *
   * `"draft"` creates the bill and stops, leaving it deletable.
   */
  action: "submit" | "draft";
  lines: SageBillLineDraft[];
};

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function num(value: unknown): number {
  if (typeof value === "number") return value;
  const n = parseFloat(str(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function blankSageBillLine(): SageBillLineDraft {
  return {
    txnAmount: "",
    memo: "",
    glAccountId: "",
    accountLabelId: "",
    departmentId: "",
    locationId: "",
    projectId: "",
  };
}

/** An empty draft for manual entry: created today, one blank line, submitted. */
export function blankSageBillDraft(): SageBillDraft {
  return {
    billNumber: "",
    vendorId: "",
    createdDate: today(),
    postingDate: "",
    dueDate: "",
    termId: "",
    referenceNumber: "",
    description: "",
    currency: "USD",
    action: "submit",
    lines: [blankSageBillLine()],
  };
}

/** Only include a ref when it has an id — Sage rejects `{ "id": "" }`. */
function ref(id: string): { id: string } | undefined {
  const value = str(id);
  return value ? { id: value } : undefined;
}

/** Drop undefined/empty values so the payload carries only fields we mean to set. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")
  ) as Partial<T>;
}

function dimensionsFor(line: SageBillLineDraft) {
  const dims = compact({
    department: ref(line.departmentId),
    location: ref(line.locationId),
    project: ref(line.projectId),
  });
  return Object.keys(dims).length ? dims : undefined;
}

/** Turn a draft into the exact JSON body `POST /objects/accounts-payable/bill` expects. */
export function sageBillPayload(draft: SageBillDraft): Record<string, unknown> {
  return compact({
    billNumber: str(draft.billNumber) || undefined,
    vendor: ref(draft.vendorId),
    createdDate: str(draft.createdDate),
    postingDate: str(draft.postingDate) || undefined,
    // Omitted when blank so Sage derives it from the payment term, exactly as the
    // .csv import does with an empty DUE_DATE column.
    dueDate: str(draft.dueDate) || undefined,
    term: ref(draft.termId),
    referenceNumber: str(draft.referenceNumber) || undefined,
    description: str(draft.description) || undefined,
    currency: str(draft.currency)
      ? { txnCurrency: str(draft.currency) }
      : undefined,
    // `state` is never sent. It is not writable on create (AR answered
    // "State must be draft or not included in the request"), the reference says it
    // cannot be PATCHed either, and Sage's own default is draft. ACTION = Submit is
    // expressed by calling the submit workflow after the create — see SageBillDraft.
    lines: draft.lines.map((line) => {
      // An account label implies the account, so when one is present the account is
      // left out and no GL-account override is requested — the same rule the AR
      // payload builder follows. With no label the account is named, which is the
      // normal way to write a bill line (and what the .csv does).
      const usesLabel = Boolean(str(line.accountLabelId));

      return compact({
        txnAmount: str(line.txnAmount),
        memo: str(line.memo) || undefined,
        glAccount: usesLabel ? undefined : ref(line.glAccountId),
        accountLabel: ref(line.accountLabelId),
        dimensions: dimensionsFor(line),
      });
    }),
  });
}

/**
 * Whether any line names a GL account with no label to derive it from.
 *
 * On the AR side this predicts a refusal. On AP it normally does **not**: the API
 * requires `glAccount` on a bill line, so naming 60200 is the ordinary case and the
 * .csv does the same thing. It is exposed because the refusal that blocks AR reads
 * *"allow **AP or AR** account override"* — if that permission turns out to bite bill
 * lines too, this is the flag that explains why, and putting a label id on the line
 * is the way around it.
 */
export function billNeedsAccountOverride(draft: SageBillDraft): boolean {
  return draft.lines.some(
    (line) => !str(line.accountLabelId) && Boolean(str(line.glAccountId))
  );
}

/** What Sage requires before it will accept a POST. */
export function validateSageBillDraft(draft: SageBillDraft): string[] {
  const problems: string[] = [];
  if (!str(draft.vendorId)) problems.push("Vendor ID is required.");
  if (!str(draft.createdDate)) problems.push("Created date is required.");
  if (!str(draft.currency)) problems.push("Currency is required.");
  if (!draft.lines.length) problems.push("At least one line is required.");
  draft.lines.forEach((line, i) => {
    const amount = num(line.txnAmount);
    if (!str(line.txnAmount) || !Number.isFinite(amount) || amount === 0) {
      problems.push(`Line ${i + 1}: amount is required and must be non-zero.`);
    }
    if (!str(line.glAccountId) && !str(line.accountLabelId)) {
      problems.push(`Line ${i + 1}: a GL account (or an account label) is required.`);
    }
  });
  return problems;
}
