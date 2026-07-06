"use client";

import { useEffect, useMemo, useState } from "react";
import type { NormalizedInvoice } from "@/lib/arColumns";
import { defaultInvoiceBatchTitle } from "@/lib/arColumns";
import { downloadInvoiceExport } from "@/lib/exportInvoice";

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

  return (
    <div className="container">
      <header className="page-header">
        <h1>Invoices → Sage Intacct AR Invoice</h1>
        <p>Export an Innergy invoice to the Sage Intacct AR Invoice import format.</p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search invoice #, customer, project, WO, status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="error">{error}</div>}

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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
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
                  <td>
                    <button className="primary" onClick={() => openExport(inv)}>
                      Export
                    </button>
                  </td>
                </tr>
              ))}
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
              Generates an .xlsx AR Invoice import file for Sage Intacct.
            </p>

            {!exportTarget.customerExternalId && (
              <div className="error">
                Heads up: this customer has no External Id set in Innergy, so
                CUSTOMER_ID will be blank. Sage requires it — set the customer’s
                Sage ID on their External Id field in Innergy to populate it.
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
                Download .xlsx
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
