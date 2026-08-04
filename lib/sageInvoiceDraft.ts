/**
 * Shape of an AR invoice about to be POSTed to Sage, plus the pure helpers that
 * build and validate its payload.
 *
 * This module is deliberately free of secrets and server-only imports: the Sage
 * test page needs the same payload builder in the browser (to preview the exact
 * JSON) that lib/sage.ts uses on the server to send it. Keeping one
 * implementation means the preview can't drift from what actually gets posted.
 *
 * Field set verified against a real CSV-imported invoice in the imp company
 * (invoice 40) and the invoice / invoice-line object models:
 *
 * - Header writable fields: invoiceNumber, invoiceDate, dueDate, description,
 *   referenceNumber, state (+ deprecated action, and invoiceMode/invoiceType/
 *   createAPBill/documentId which nothing here uses). `customer` is a ref.
 * - Line writable fields: only `memo` and `txnAmount`. Everything else is a ref
 *   (glAccount, overrideOffsetGLAccount, accountLabel) or a dimension.
 * - `overrideOffsetGLAccount` carries the AR control account (12100) — the same
 *   account the CSV export writes into ARINVOICEITEM_ARACCOUNT.
 */

export type SageInvoiceLineDraft = {
  txnAmount: string;
  memo: string;
  glAccountId: string;
  offsetGLAccountId: string;
  accountLabelId: string;
  departmentId: string;
  locationId: string;
  projectId: string;
};

export type SageInvoiceDraft = {
  invoiceNumber: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  referenceNumber: string;
  /** "posted" (Sage's default) hits the GL; "draft" can be deleted cleanly. */
  state: "posted" | "draft";
  lines: SageInvoiceLineDraft[];
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

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function blankSageInvoiceLine(): SageInvoiceLineDraft {
  return {
    txnAmount: "",
    memo: "",
    glAccountId: "",
    offsetGLAccountId: "",
    accountLabelId: "",
    departmentId: "",
    locationId: "",
    projectId: "",
  };
}

/** An empty draft for manual entry: today, due in 30 days, one blank line. */
export function blankSageInvoiceDraft(): SageInvoiceDraft {
  return {
    invoiceNumber: "",
    customerId: "",
    invoiceDate: today(),
    dueDate: plusDays(30),
    description: "",
    referenceNumber: "",
    state: "posted",
    lines: [blankSageInvoiceLine()],
  };
}

/**
 * Build a draft from an existing invoice's detail record — the "clone" path.
 * Dates, amounts, accounts and dimensions all carry over; the caller decides what
 * to do about the invoice number, since Sage rejects a duplicate.
 */
export function sageInvoiceDraftFromDetail(raw: any): SageInvoiceDraft {
  const lines: SageInvoiceLineDraft[] = (raw?.lines || []).map((line: any) => ({
    txnAmount: str(line?.txnAmount),
    memo: str(line?.memo),
    glAccountId: str(line?.glAccount?.id),
    offsetGLAccountId: str(line?.overrideOffsetGLAccount?.id),
    accountLabelId: str(line?.accountLabel?.id),
    departmentId: str(line?.dimensions?.department?.id),
    locationId: str(line?.dimensions?.location?.id),
    projectId: str(line?.dimensions?.project?.id),
  }));

  return {
    invoiceNumber: str(raw?.invoiceNumber),
    customerId: str(raw?.customer?.id),
    invoiceDate: str(raw?.invoiceDate) || today(),
    dueDate: str(raw?.dueDate) || plusDays(30),
    description: str(raw?.description),
    referenceNumber: str(raw?.referenceNumber),
    state: "posted",
    lines: lines.length ? lines : [blankSageInvoiceLine()],
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

function dimensionsFor(line: SageInvoiceLineDraft) {
  const dims = compact({
    department: ref(line.departmentId),
    location: ref(line.locationId),
    project: ref(line.projectId),
  });
  return Object.keys(dims).length ? dims : undefined;
}

/** Turn a draft into the exact JSON body Sage expects. */
export function sageInvoicePayload(
  draft: SageInvoiceDraft
): Record<string, unknown> {
  return compact({
    invoiceNumber: str(draft.invoiceNumber) || undefined,
    customer: ref(draft.customerId),
    invoiceDate: str(draft.invoiceDate),
    dueDate: str(draft.dueDate),
    description: str(draft.description) || undefined,
    referenceNumber: str(draft.referenceNumber) || undefined,
    state: draft.state,
    lines: draft.lines.map((line) =>
      compact({
        txnAmount: str(line.txnAmount),
        memo: str(line.memo) || undefined,
        glAccount: ref(line.glAccountId),
        overrideOffsetGLAccount: ref(line.offsetGLAccountId),
        accountLabel: ref(line.accountLabelId),
        dimensions: dimensionsFor(line),
      })
    ),
  });
}

/** What Sage requires before it will accept a POST. */
export function validateSageInvoiceDraft(draft: SageInvoiceDraft): string[] {
  const problems: string[] = [];
  if (!str(draft.customerId)) problems.push("Customer ID is required.");
  if (!str(draft.invoiceDate)) problems.push("Invoice date is required.");
  if (!str(draft.dueDate)) problems.push("Due date is required.");
  if (!draft.lines.length) problems.push("At least one line is required.");
  draft.lines.forEach((line, i) => {
    const amount = num(line.txnAmount);
    if (!str(line.txnAmount) || !Number.isFinite(amount) || amount === 0) {
      problems.push(`Line ${i + 1}: amount is required and must be non-zero.`);
    }
  });
  return problems;
}
