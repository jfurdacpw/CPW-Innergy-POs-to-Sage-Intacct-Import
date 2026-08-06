"use client";

import { useMemo, useState } from "react";
import {
  billNeedsAccountOverride,
  blankSageBillLine,
  sageBillPayload,
  validateSageBillDraft,
  type SageBillDraft,
  type SageBillLineDraft,
} from "@/lib/sageBillDraft";

/**
 * Post an AP bill to Sage — the direct-API twin of the AP Bill .csv download, and
 * the AP counterpart of PostInvoiceDialog. Every field is editable and the exact
 * JSON is viewable before anything is sent.
 *
 * This dialog WRITES to Sage. With action "submit" the bill is created and then put
 * through `POST /workflows/accounts-payable/bill/submit`, exactly as the .csv's
 * `ACTION = "Submit"` column asks for.
 */
export default function PostBillDialog({
  initialDraft,
  entity,
  sourceLabel,
  notices,
  onClose,
  onPosted,
}: {
  initialDraft: SageBillDraft;
  entity: string;
  /** e.g. "Innergy PO PO-100002" — shown in the heading. */
  sourceLabel: string;
  /** Extra warnings from whoever built the draft (e.g. a fallback vendor). */
  notices?: React.ReactNode[];
  onClose: () => void;
  onPosted: (result: {
    key: string;
    id: string;
    submitted: boolean;
    submitError?: string;
  }) => void;
}) {
  const [draft, setDraft] = useState<SageBillDraft>(initialDraft);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(undefined);
  const [showPayload, setShowPayload] = useState(false);

  const problems = useMemo(() => validateSageBillDraft(draft), [draft]);
  const payload = useMemo(() => sageBillPayload(draft), [draft]);
  const namesAccount = useMemo(() => billNeedsAccountOverride(draft), [draft]);

  const total = draft.lines.reduce(
    (sum, l) => sum + (parseFloat(l.txnAmount) || 0),
    0
  );

  function setField<K extends keyof SageBillDraft>(
    key: K,
    value: SageBillDraft[K]
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLine(index: number, key: keyof SageBillLineDraft, value: string) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    }));
  }

  function addLine() {
    setDraft((d) => {
      // Copy accounts/dimensions off the last line — a second line on the same bill
      // normally differs only in amount and memo.
      const last = d.lines[d.lines.length - 1];
      return {
        ...d,
        lines: [
          ...d.lines,
          last ? { ...last, txnAmount: "", memo: "" } : blankSageBillLine(),
        ],
      };
    });
  }

  function removeLine(index: number) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
  }

  async function post() {
    setPosting(true);
    setError(null);
    setErrorDetails(undefined);
    try {
      const res = await fetch("/api/sage/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorDetails(body.details);
        throw new Error(body.error || "Post failed.");
      }
      onPosted({
        key: body.key,
        id: body.id,
        submitted: Boolean(body.submitted),
        submitError: body.submitError,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post failed.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !posting) onClose();
      }}
    >
      <div className="modal modal-wide">
        <h2>Post bill to Sage</h2>
        <p className="hint">
          {sourceLabel} · entity {entity || "top level"} ·{" "}
          {draft.action === "submit"
            ? "creates the bill, then submits it (ACTION = Submit)"
            : "creates the bill and leaves it in the draft queue"}
        </p>

        {error && <div className="error">{error}</div>}
        {error && errorDetails ? (
          <pre className="raw">{JSON.stringify(errorDetails, null, 2)}</pre>
        ) : null}

        {notices?.map((notice, i) => (
          <div className="notice" key={i}>
            {notice}
          </div>
        ))}

        <div className="grid-2">
          <Field label="Bill number">
            <input
              type="text"
              value={draft.billNumber}
              placeholder="blank → Sage assigns one"
              onChange={(e) => setField("billNumber", e.target.value)}
            />
          </Field>
          <Field label="Vendor ID">
            <input
              type="text"
              value={draft.vendorId}
              onChange={(e) => setField("vendorId", e.target.value)}
            />
          </Field>
          <Field label="Created date">
            <input
              type="date"
              value={draft.createdDate}
              onChange={(e) => setField("createdDate", e.target.value)}
            />
          </Field>
          <Field label="Posting date">
            <input
              type="date"
              value={draft.postingDate}
              onChange={(e) => setField("postingDate", e.target.value)}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => setField("dueDate", e.target.value)}
            />
          </Field>
          <Field label="Payment term">
            <input
              type="text"
              value={draft.termId}
              placeholder="e.g. Net 30"
              onChange={(e) => setField("termId", e.target.value)}
            />
          </Field>
          <Field label="Reference number (PO)">
            <input
              type="text"
              value={draft.referenceNumber}
              onChange={(e) => setField("referenceNumber", e.target.value)}
            />
          </Field>
          <Field label="Description">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <input
              type="text"
              value={draft.currency}
              onChange={(e) => setField("currency", e.target.value)}
            />
          </Field>
          <Field label="After create">
            <select
              value={draft.action}
              onChange={(e) =>
                setField("action", e.target.value as SageBillDraft["action"])
              }
            >
              <option value="submit">submit (matches ACTION = Submit)</option>
              <option value="draft">leave as draft (deletable)</option>
            </select>
          </Field>
        </div>

        {!draft.dueDate && (
          <div className="hint">
            Due date is blank on purpose — the .csv leaves the column empty and Sage
            derives the date from the payment term
            {draft.termId ? ` (${draft.termId})` : ""}. Fill it in only if Sage
            rejects the create for a missing <code>dueDate</code>.
          </div>
        )}

        <div className="lines-head">
          <h3>
            Lines <span className="meta">total {total.toFixed(2)}</span>
          </h3>
          <div className="head-actions">
            <button className="ghost" onClick={addLine} disabled={posting}>
              Add line
            </button>
          </div>
        </div>

        {namesAccount && (
          <div className="notice">
            <strong>The line names its GL account.</strong> That is normal for a bill
            — <code>glAccount</code> is required on an AP line and the .csv writes{" "}
            <code>ACCT_NO</code> the same way. Worth knowing anyway: the refusal that
            currently blocks taxed AR invoices reads &ldquo;allow{" "}
            <strong>AP or AR</strong> account override&rdquo;, so if a bill draws{" "}
            <code>AP-0…</code> about GL account override, the fix is the same — put a
            non-subtotal account label in the <em>Account label</em> column here (or
            enable the override in Sage) and the account is left out of the payload.
          </div>
        )}

        <div className="table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th>Amount</th>
                <th>Memo</th>
                <th>GL account</th>
                <th>Account label</th>
                <th>Dept</th>
                <th>Location</th>
                <th>Project</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="w-amount"
                      type="text"
                      inputMode="decimal"
                      value={line.txnAmount}
                      onChange={(e) => setLine(i, "txnAmount", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.memo}
                      onChange={(e) => setLine(i, "memo", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="w-acct"
                      type="text"
                      value={line.glAccountId}
                      onChange={(e) => setLine(i, "glAccountId", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.accountLabelId}
                      onChange={(e) => setLine(i, "accountLabelId", e.target.value)}
                      title="Set this and the GL account is left out of the payload"
                    />
                  </td>
                  <td>
                    <input
                      className="w-dim"
                      type="text"
                      value={line.departmentId}
                      onChange={(e) => setLine(i, "departmentId", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="w-dim"
                      type="text"
                      value={line.locationId}
                      onChange={(e) => setLine(i, "locationId", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="w-dim"
                      type="text"
                      value={line.projectId}
                      onChange={(e) => setLine(i, "projectId", e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      className="ghost"
                      onClick={() => removeLine(i)}
                      disabled={posting || draft.lines.length === 1}
                      title={
                        draft.lines.length === 1
                          ? "A bill needs at least one line"
                          : "Remove this line"
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {problems.length > 0 && (
          <div className="notice">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}

        <label className="inline-field payload-toggle">
          <input
            type="checkbox"
            checked={showPayload}
            onChange={(e) => setShowPayload(e.target.checked)}
          />
          Show the exact JSON that will be sent
        </label>
        {showPayload && <pre className="raw">{JSON.stringify(payload, null, 2)}</pre>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={posting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={post}
            disabled={posting || problems.length > 0}
          >
            {posting
              ? "Posting…"
              : draft.action === "submit"
                ? "Post & submit to Sage"
                : "Create draft in Sage"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
