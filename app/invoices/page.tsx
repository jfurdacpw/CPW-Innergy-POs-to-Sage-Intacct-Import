"use client";

import { useEffect, useMemo, useState } from "react";
import type { NormalizedInvoice } from "@/lib/arColumns";
import {
  defaultInvoiceBatchTitle,
  FALLBACK_CUSTOMER_ID,
} from "@/lib/arColumns";
import { downloadInvoiceExport } from "@/lib/exportInvoice";
import type { SageInvoiceDraft } from "@/lib/sageInvoiceDraft";
import {
  innergyInvoiceTaxIsBlocked,
  sageDraftFromInnergyInvoice,
} from "@/lib/sageInvoiceFromInnergy";
import { SAGE_ENTITY_CHOICES } from "@/lib/sageEntities";
import PostInvoiceDialog from "@/app/components/PostInvoiceDialog";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<NormalizedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [exportTarget, setExportTarget] = useState<NormalizedInvoice | null>(
    null
  );
  const [batchTitle, setBatchTitle] = useState("");

  /** Which Sage sub-entity a Post to Sage lands in. Seeded from SAGE_ENTITY_ID. */
  const [entity, setEntity] = useState("20");

  /** Open post dialog: the draft plus the invoice it came from. null = closed. */
  const [post, setPost] = useState<{
    draft: SageInvoiceDraft;
    invoice: NormalizedInvoice;
  } | null>(null);
  const [posted, setPosted] = useState<{
    key: string;
    id: string;
    invoiceNumber: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/invoices");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load.");
        if (!cancelled) setInvoices(body.invoices);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Seed the entity picker from the server's SAGE_ENTITY_ID, resolving null the same
   * way the Sage tab does (blank = top level) so the two pages can't send the same
   * invoice to different entities.
   *
   * `?config=1` reads env only — no token, no Sage call. This page's main workflow is
   * a .csv download, so it must not pay a Sage round-trip (or surface a token error)
   * just to fill a picker. A failure is ignored and the default stands.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sage/status?config=1");
        const body = await res.json();
        if (!cancelled) setEntity(body?.config?.defaultEntityId ?? "");
      } catch {
        /* keep the default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) =>
      [
        inv.invoiceNumber,
        inv.customerName,
        inv.projectName,
        inv.projectNumber,
        inv.status,
        ...inv.workOrderNumbers,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [invoices, query]);

  function openExport(inv: NormalizedInvoice) {
    setExportTarget(inv);
    setBatchTitle(defaultInvoiceBatchTitle(inv.invoiceNumber));
  }

  function confirmExport() {
    if (!exportTarget) return;
    downloadInvoiceExport(exportTarget, { batchTitle });
    setExportTarget(null);
  }

  /**
   * Open the Sage post dialog with this Innergy invoice mapped to a draft — the
   * same fields the .csv would carry, as JSON. Every field stays editable and the
   * dialog can show the exact payload before it sends.
   */
  function openPost(inv: NormalizedInvoice) {
    setPosted(null);
    setPost({ draft: sageDraftFromInnergyInvoice(inv), invoice: inv });
  }

  return (
    <div className="container">
      <header className="page-header">
        <h1>Invoices → Sage Intacct AR Invoice</h1>
        <p>
          Send an Innergy invoice to Sage Intacct — either straight through the
          API (<strong>Post to Sage</strong>) or as a .csv import file for the
          AR Invoice template.
        </p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search invoice #, customer, project, WO, status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="inline-field">
          Sage entity
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            {SAGE_ENTITY_CHOICES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {posted && (
        <div className="notice success">
          Sent {posted.invoiceNumber} to Sage — invoice{" "}
          <strong>{posted.id}</strong> (record key {posted.key}) in entity{" "}
          {entity || "top level"}. Check it on the Sage tab.
        </div>
      )}

      {loading ? (
        <div className="state">Loading invoices…</div>
      ) : filtered.length === 0 ? (
        <div className="state">No invoices match.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Project</th>
                <th>Work order(s)</th>
                <th>Due</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th className="num">Tax</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                // The API route is refused for taxed invoices, so on those rows the
                // .csv stays the primary action — otherwise the emphasised button is
                // the one that can't work. See innergyInvoiceTaxIsBlocked.
                const blocked = innergyInvoiceTaxIsBlocked(inv);
                return (
                <tr key={inv.id}>
                  <td>{inv.invoiceNumber || "—"}</td>
                  <td>{inv.customerName || "—"}</td>
                  <td>{inv.projectNumber || inv.projectName || "—"}</td>
                  <td>{inv.workOrderNumbers.join(", ") || "—"}</td>
                  <td>{inv.dueDate || "—"}</td>
                  <td>{inv.status || "—"}</td>
                  <td className="num">
                    {currency.format(inv.invoiceAmount || 0)}
                  </td>
                  <td className="num">
                    {inv.salesTax ? currency.format(inv.salesTax) : "—"}
                  </td>
                  <td>
                    <div className="head-actions">
                      <button
                        className={blocked ? "ghost" : "primary"}
                        onClick={() => openPost(inv)}
                        title={
                          blocked
                            ? "Taxed invoices are refused by the API until a non-subtotal 33500 account label exists in Sage"
                            : "Push this invoice into Sage through the API"
                        }
                      >
                        Post to Sage
                      </button>
                      <button
                        className={blocked ? "primary" : "ghost"}
                        onClick={() => openExport(inv)}
                      >
                        Export .csv
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {exportTarget && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExportTarget(null);
          }}
        >
          <div className="modal">
            <h2>Export invoice {exportTarget.invoiceNumber}</h2>
            <p className="hint">
              Generates a .csv AR Invoice import file for Sage Intacct.
            </p>

            {!exportTarget.customerExternalId && (
              <div className="error">
                Heads up: this customer has no External Id set in Innergy, so
                CUSTOMER_ID will export as the fallback default (
                {FALLBACK_CUSTOMER_ID}). Set the customer’s Sage ID on their
                External Id field in Innergy to have the real value populate
                instead.
              </div>
            )}

            <div className="field">
              <label htmlFor="batchTitle">Batch title</label>
              <input
                id="batchTitle"
                type="text"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
              />
              <div className="hint">
                Sage pre-pends “HISTORY – ” to this value on import.
              </div>
            </div>

            <div className="modal-actions">
              <button className="ghost" onClick={() => setExportTarget(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={confirmExport}
                disabled={!batchTitle.trim()}
              >
                Download .csv
              </button>
            </div>
          </div>
        </div>
      )}

      {post && (
        <PostInvoiceDialog
          initialDraft={post.draft}
          entity={entity}
          sourceLabel={`Innergy invoice ${post.invoice.invoiceNumber}`}
          notices={postNotices(post.invoice)}
          onClose={() => setPost(null)}
          onPosted={(result) => {
            setPost(null);
            setPosted({ ...result, invoiceNumber: post.invoice.invoiceNumber });
          }}
        />
      )}
    </div>
  );
}

/**
 * Warnings specific to pushing an *Innergy* invoice (the dialog raises its own
 * about subtotal rows and GL overrides).
 */
function postNotices(inv: NormalizedInvoice): React.ReactNode[] {
  const notices: React.ReactNode[] = [];

  if (!inv.customerExternalId) {
    notices.push(
      <>
        <strong>Fallback customer.</strong> {inv.customerName || "This customer"}{" "}
        has no External Id in Innergy, so the customer is{" "}
        <code>{FALLBACK_CUSTOMER_ID}</code> and the project falls back with it.
        That is why this defaults to <strong>draft</strong> rather than posted —
        set the Sage customer ID on their External Id field in Innergy to send the
        real one.
      </>
    );
  }

  if (innergyInvoiceTaxIsBlocked(inv)) {
    notices.push(
      <>
        <strong>Taxed invoice — expect a refusal.</strong> The{" "}
        {currency.format(inv.salesTax ?? 0)} tax line has to name account 33500
        directly, because every tax account label in this company is a{" "}
        <em>subtotal</em> label and those are rejected on line items (
        <code>AR-0148</code>). Naming the account instead is a GL override, which
        the API refuses (<code>AR-0279</code>) even though the .csv import does it
        happily. Until a non-subtotal <code>33500</code> label exists in Sage, use
        Export .csv for taxed invoices.
      </>
    );
  }

  return notices;
}
