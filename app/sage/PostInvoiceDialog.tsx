"use client";

import { useMemo, useState } from "react";
import {
  blankSageInvoiceLine,
  sageInvoicePayload,
  validateSageInvoiceDraft,
  type SageInvoiceDraft,
  type SageInvoiceLineDraft,
} from "@/lib/sageInvoiceDraft";

/**
 * Post an AR invoice to Sage — either a clone of an existing record (every field
 * prefilled) or a hand-entered one. Every field is editable in both cases.
 *
 * This dialog WRITES to Sage. With state "posted" the invoice hits the GL exactly
 * as a CSV import would, so the button says so and the payload is shown before
 * sending.
 */
export default function PostInvoiceDialog({
  initialDraft,
  entity,
  sourceLabel,
  onClose,
  onPosted,
}: {
  initialDraft: SageInvoiceDraft;
  entity: string;
  /** e.g. "clone of INV-26-100002" — shown in the heading. */
  sourceLabel: string;
  onClose: () => void;
  onPosted: (result: { key: string; id: string }) => void;
}) {
  const [draft, setDraft] = useState<SageInvoiceDraft>(initialDraft);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(undefined);
  const [showPayload, setShowPayload] = useState(false);

  const problems = useMemo(() => validateSageInvoiceDraft(draft), [draft]);
  const payload = useMemo(() => sageInvoicePayload(draft), [draft]);

  const total = draft.lines.reduce(
    (sum, l) => sum + (parseFloat(l.txnAmount) || 0),
    0
  );

  function setField<K extends keyof SageInvoiceDraft>(
    key: K,
    value: SageInvoiceDraft[K]
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setLine(
    index: number,
    key: keyof SageInvoiceLineDraft,
    value: string
  ) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    }));
  }

  /**
   * Add a sales-tax subtotal row matching RKL's manually-entered IN-1002: a
   * Subtotals-grid line on 33500 with the "Tax" account label, carrying the
   * dimensions of the line above it.
   */
  function addTaxSubtotal() {
    setDraft((d) => {
      const last = d.lines[d.lines.length - 1] ?? blankSageInvoiceLine();
      return {
        ...d,
        lines: [
          ...d.lines,
          {
            ...last,
            txnAmount: "",
            memo: "Sales Tax",
            kind: "subtotal",
            glAccountId: "33500",
            accountLabelId: "Tax",
          },
        ],
      };
    });
  }

  function addLine() {
    setDraft((d) => {
      // Copy accounts/dimensions from the last line — on a real invoice the second
      // line (e.g. sales tax) shares everything but the amount and GL account.
      const last = d.lines[d.lines.length - 1];
      return {
        ...d,
        lines: [
          ...d.lines,
          last ? { ...last, txnAmount: "", memo: "" } : blankSageInvoiceLine(),
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
      const res = await fetch("/api/sage/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity, draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorDetails(body.details);
        throw new Error(body.error || "Post failed.");
      }
      onPosted({ key: body.key, id: body.id });
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
        <h2>Post invoice to Sage</h2>
        <p className="hint">
          {sourceLabel} · entity {entity || "top level"} · writes to the{" "}
          {draft.state === "posted" ? "GL immediately" : "draft queue"}
        </p>

        {error && <div className="error">{error}</div>}
        {error && errorDetails ? (
          <pre className="raw">{JSON.stringify(errorDetails, null, 2)}</pre>
        ) : null}

        <div className="grid-2">
          <Field label="Invoice number">
            <input
              type="text"
              value={draft.invoiceNumber}
              placeholder="blank → Sage assigns one"
              onChange={(e) => setField("invoiceNumber", e.target.value)}
            />
          </Field>
          <Field label="Customer ID">
            <input
              type="text"
              value={draft.customerId}
              onChange={(e) => setField("customerId", e.target.value)}
            />
          </Field>
          <Field label="Invoice date">
            <input
              type="date"
              value={draft.invoiceDate}
              onChange={(e) => setField("invoiceDate", e.target.value)}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => setField("dueDate", e.target.value)}
            />
          </Field>
          <Field label="Description">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>
          <Field label="Reference number">
            <input
              type="text"
              value={draft.referenceNumber}
              onChange={(e) => setField("referenceNumber", e.target.value)}
            />
          </Field>
          <Field label="State">
            <select
              value={draft.state}
              onChange={(e) =>
                setField("state", e.target.value as SageInvoiceDraft["state"])
              }
            >
              <option value="posted">posted (hits the GL)</option>
              <option value="draft">draft (deletable)</option>
            </select>
          </Field>
        </div>

        <div className="lines-head">
          <h3>
            Lines <span className="meta">total {total.toFixed(2)}</span>
          </h3>
          <div className="head-actions">
            <button className="ghost" onClick={addTaxSubtotal} disabled={posting}>
              Add tax subtotal
            </button>
            <button className="ghost" onClick={addLine} disabled={posting}>
              Add line
            </button>
          </div>
        </div>

        {draft.lines.some((l) => l.kind) && (
          <div className="notice">
            A subtotal/tax row is designated. Sage&rsquo;s object model marks{" "}
            <code>isSubtotal</code> read-only, so whether it accepts the
            designation on create is unproven — if it rejects it, the error text
            will say so exactly. IN-1002&rsquo;s tax row is{" "}
            <code>isSubtotal: &quot;subtotal&quot;</code>, account 33500, label
            &ldquo;Tax&rdquo;.
          </div>
        )}

        <div className="table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Memo</th>
                <th>GL account</th>
                <th>AR offset</th>
                <th>Account label</th>
                <th>Dept</th>
                <th>Location</th>
                <th>Project</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line, i) => (
                <tr key={i} className={line.kind ? "line-subtotal" : undefined}>
                  <td>
                    <select
                      className="w-kind"
                      value={line.kind}
                      onChange={(e) => setLine(i, "kind", e.target.value)}
                      title="A subtotal/tax row sits in Sage's Subtotals grid instead of Entries"
                    >
                      <option value="">Entry</option>
                      <option value="subtotal">Subtotal</option>
                      <option value="tax">Tax</option>
                    </select>
                  </td>
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
                      className="w-acct"
                      type="text"
                      value={line.offsetGLAccountId}
                      onChange={(e) =>
                        setLine(i, "offsetGLAccountId", e.target.value)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={line.accountLabelId}
                      onChange={(e) => setLine(i, "accountLabelId", e.target.value)}
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
                          ? "An invoice needs at least one line"
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
              : draft.state === "posted"
                ? "Post to Sage"
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
