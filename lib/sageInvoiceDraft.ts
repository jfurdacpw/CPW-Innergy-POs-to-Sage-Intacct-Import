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

/**
 * How a line sits on the invoice, as Sage reports it in `isSubtotal`
 * (null / "subtotal" / "tax"). A subtotal row lives in the invoice's Subtotals grid
 * rather than Entries — that is how RKL's manually-entered IN-1002 carries its sales
 * tax (line 2: 78.00, isSubtotal "subtotal", account 33500, label "Tax").
 *
 * On READ this is faithful. On WRITE, a real subtotal row is **not creatable** — both
 * routes were tried live against the imp company and both are closed:
 *
 *  1. `isSubtotal` itself → `REST-1050 IA.READ_ONLY_FIELD`
 *     "/lines/2/isSubtotal is a read-only field". AR invoices also expose no
 *     subtotals collection; the API's subtotal objects are Order Entry and GET-only.
 *  2. A subtotal account label on a line item → `AR-0148` "Subtotal account labels
 *     are not valid for line items" (plus `AR-0279` "we cannot create the
 *     transaction") — the same wall the CSV importer hit in July.
 *
 * So a designated line posts as a plain GL line with **no account label**, which is
 * what the CSV export already does for tax (ACCT_NO 33500, ACCT_LABEL blank). The GL
 * effect is identical: AR debit = revenue + tax. The designation is kept because it
 * is meaningful on read (clones show how Sage classified each line) and because it
 * drives this label-stripping on write.
 *
 * "" means a normal entry line.
 */
export type SageLineKind = "" | "subtotal" | "tax";

export type SageInvoiceLineDraft = {
  txnAmount: string;
  memo: string;
  glAccountId: string;
  offsetGLAccountId: string;
  accountLabelId: string;
  departmentId: string;
  locationId: string;
  projectId: string;
  /** Designates this line as a Subtotals-grid row. See SageLineKind. */
  kind: SageLineKind;
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
    kind: "",
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

/** Read a value that may be nested (`{a:{b:1}}`) or a flat dotted key (`"a.b"`). */
function deep(raw: any, path: string): string {
  const flat = raw?.[path];
  if (flat !== undefined && flat !== null && flat !== "") return str(flat);
  const nested = path
    .split(".")
    .reduce((acc: any, part) => (acc == null ? acc : acc[part]), raw);
  return str(nested);
}

/**
 * Map one line — from either an invoice detail record's `lines[]` (nested) or an
 * invoice-line query row (flat dotted keys).
 */
export function sageLineDraftFrom(line: any): SageInvoiceLineDraft {
  const kind = deep(line, "isSubtotal");
  return {
    txnAmount: deep(line, "txnAmount"),
    memo: deep(line, "memo"),
    glAccountId: deep(line, "glAccount.id"),
    offsetGLAccountId: deep(line, "overrideOffsetGLAccount.id"),
    accountLabelId: deep(line, "accountLabel.id"),
    departmentId: deep(line, "dimensions.department.id"),
    locationId: deep(line, "dimensions.location.id"),
    projectId: deep(line, "dimensions.project.id"),
    kind: kind === "subtotal" || kind === "tax" ? kind : "",
  };
}

/**
 * Build a draft from an existing invoice — the "clone" path. Dates, amounts,
 * accounts, dimensions and each line's subtotal designation carry over; the caller
 * decides what to do about the invoice number, since Sage rejects a duplicate.
 *
 * `lines` should come from an invoice-line QUERY, not the detail record: a detail
 * GET omits subtotal rows entirely (invoice 24 returns one 1300.00 line and hides
 * its 78.00 tax subtotal), so cloning from `raw.lines` silently loses them.
 */
export function sageInvoiceDraftFromDetail(
  raw: any,
  queriedLines?: any[]
): SageInvoiceDraft {
  const source =
    queriedLines && queriedLines.length ? queriedLines : raw?.lines || [];
  const lines: SageInvoiceLineDraft[] = source.map(sageLineDraftFrom);

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
    lines: draft.lines.map((line) => {
      // Naming a GL account directly IS a GL account override, and Sage refuses it
      // without the config/permission for it:
      //   "You are trying to add data to Intacct that requires configuration changes
      //    or user permissions ... enable GL account override"
      // An account label already implies both accounts (e.g.
      // "50200-Furniture Sales - Taxable" -> gl 50200, offset 12100), so when a
      // usable label is present the accounts are left out and no override is asked
      // for. They are only sent when there is no label to derive them from.
      const usesLabel = !line.kind && Boolean(str(line.accountLabelId));

      return compact({
        txnAmount: str(line.txnAmount),
        memo: str(line.memo) || undefined,
        glAccount: usesLabel ? undefined : ref(line.glAccountId),
        overrideOffsetGLAccount: usesLabel
          ? undefined
          : ref(line.offsetGLAccountId),
        // A designated subtotal/tax line drops its account label. Both routes to a
        // real Subtotals-grid row are closed (see SageLineKind), and a subtotal
        // label on a line item is itself rejected:
        //   AR-0148 "Subtotal account labels are not valid for line items"
        // So the line posts as a plain GL line — exactly what the CSV export does
        // for tax (ACCT_NO 33500, ACCT_LABEL blank). Same GL effect.
        accountLabel: line.kind ? undefined : ref(line.accountLabelId),
        // Never sent: Sage answers
        //   REST-1050 IA.READ_ONLY_FIELD "/lines/2/isSubtotal is a read-only field"
        dimensions: dimensionsFor(line),
      });
    }),
  });
}

/**
 * Does this draft need the GL-account-override config/permission that Sage currently
 * refuses? True when any line names accounts without a label to derive them from —
 * which is the case for a tax line, since every tax account label in the imp company
 * is a subtotal label and those are invalid on line items.
 */
export function draftNeedsAccountOverride(draft: SageInvoiceDraft): boolean {
  return draft.lines.some(
    (line) =>
      (line.kind || !str(line.accountLabelId)) &&
      (Boolean(str(line.glAccountId)) || Boolean(str(line.offsetGLAccountId)))
  );
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
