"use client";

import { useEffect, useMemo, useState } from "react";
import type { NormalizedPurchaseOrder } from "@/lib/sageColumns";
import { defaultBatchTitle } from "@/lib/sageColumns";
import { downloadPOExport } from "@/lib/exportPO";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function Home() {
  const [pos, setPos] = useState<NormalizedPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reconciledOnly, setReconciledOnly] = useState(false);

  // Export modal state.
  const [exportTarget, setExportTarget] =
    useState<NormalizedPurchaseOrder | null>(null);
  const [batchTitle, setBatchTitle] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/purchase-orders");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load.");
        if (!cancelled) setPos(body.purchaseOrders);
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
    return pos.filter((po) => {
      if (reconciledOnly && !po.isReconciled) return false;
      if (!q) return true;
      return [po.poNumber, po.vendorName, po.projectName, po.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [pos, query, reconciledOnly]);

  function openExport(po: NormalizedPurchaseOrder) {
    setExportTarget(po);
    setBatchTitle(defaultBatchTitle(po.poNumber));
    setExportError(null);
  }

  async function confirmExport() {
    if (!exportTarget) return;
    setExporting(true);
    setExportError(null);
    try {
      // Re-fetch detail for the freshest numbers before exporting.
      const res = await fetch(
        `/api/purchase-orders/${encodeURIComponent(exportTarget.id)}`
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load PO detail.");
      const po: NormalizedPurchaseOrder = body.purchaseOrder;

      if (!po.isReconciled) {
        throw new Error("This PO is no longer reconciled and cannot be exported.");
      }
      downloadPOExport(po, { batchTitle });
      setExportTarget(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="container">
      <header className="page-header">
        <h1>Innergy PO → Sage Intacct Exporter</h1>
        <p>
          Export a reconciled purchase order to the Sage Intacct AP Bill import
          format.
        </p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search PO #, vendor, project, status…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={reconciledOnly}
            onChange={(e) => setReconciledOnly(e.target.checked)}
          />
          Reconciled only
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="state">Loading purchase orders…</div>
      ) : filtered.length === 0 ? (
        <div className="state">No purchase orders match.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Vendor</th>
                <th>Project</th>
                <th>Status</th>
                <th className="num">Received Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => (
                <tr key={po.id}>
                  <td>{po.poNumber || "—"}</td>
                  <td>{po.vendorName || "—"}</td>
                  <td>{po.projectName || "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        po.isReconciled ? "reconciled" : "not-reconciled"
                      }`}
                    >
                      {po.isReconciled ? "Reconciled" : po.status || "Not reconciled"}
                    </span>
                  </td>
                  <td className="num">
                    {currency.format(po.receivedTotalCost || 0)}
                  </td>
                  <td>
                    <button
                      className="primary"
                      disabled={!po.isReconciled}
                      title={
                        po.isReconciled
                          ? "Export to Sage Intacct AP Bill format"
                          : "Only reconciled POs can be exported"
                      }
                      onClick={() => openExport(po)}
                    >
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
            if (e.target === e.currentTarget && !exporting) setExportTarget(null);
          }}
        >
          <div className="modal">
            <h2>Export PO {exportTarget.poNumber}</h2>
            <p className="hint">
              Generates a .csv AP Bill import file for Sage Intacct.
            </p>

            {exportError && <div className="error">{exportError}</div>}

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
              <button
                className="ghost"
                onClick={() => setExportTarget(null)}
                disabled={exporting}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={confirmExport}
                disabled={exporting || !batchTitle.trim()}
              >
                {exporting ? "Exporting…" : "Download .csv"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
