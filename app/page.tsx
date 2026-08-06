"use client";

import { useEffect, useMemo, useState } from "react";
import type { NormalizedPurchaseOrder } from "@/lib/sageColumns";
import { defaultBatchTitle, FALLBACK_VENDOR_ID } from "@/lib/sageColumns";
import { downloadPOExport } from "@/lib/exportPO";
import type { SageBillDraft } from "@/lib/sageBillDraft";
import {
  innergyPOUsesFallbackVendor,
  sageDraftFromInnergyPO,
} from "@/lib/sageBillFromInnergy";
import { SAGE_ENTITY_CHOICES } from "@/lib/sageEntities";
import PostBillDialog from "@/app/components/PostBillDialog";

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

  /** Which Sage sub-entity a Post to Sage lands in. Seeded from SAGE_ENTITY_ID. */
  const [entity, setEntity] = useState("20");

  /** Open post dialog: the draft plus the PO it came from. null = closed. */
  const [post, setPost] = useState<{
    draft: SageBillDraft;
    po: NormalizedPurchaseOrder;
  } | null>(null);
  /** Which PO's detail is being re-fetched before its dialog opens. */
  const [preparing, setPreparing] = useState<string | null>(null);
  const [posted, setPosted] = useState<{
    key: string;
    id: string;
    poNumber: string;
    submitted: boolean;
    submitError?: string;
  } | null>(null);

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

  /**
   * Seed the entity picker from the server's SAGE_ENTITY_ID, exactly as the
   * Invoices tab does, so the same record can't be sent to different entities from
   * different pages. `?config=1` reads env only — no token, no Sage round-trip.
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

  /**
   * Re-fetch a PO's detail for the freshest numbers and re-check the reconciled
   * gate. Both routes out of this page go through it — an API post must not be an
   * easier way to send a PO that the .csv would refuse.
   */
  async function freshReconciledPO(
    target: NormalizedPurchaseOrder
  ): Promise<NormalizedPurchaseOrder> {
    const res = await fetch(
      `/api/purchase-orders/${encodeURIComponent(target.id)}`
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Failed to load PO detail.");
    const po: NormalizedPurchaseOrder = body.purchaseOrder;
    if (!po.isReconciled) {
      throw new Error("This PO is no longer reconciled and cannot be sent to Sage.");
    }
    return po;
  }

  async function confirmExport() {
    if (!exportTarget) return;
    setExporting(true);
    setExportError(null);
    try {
      const po = await freshReconciledPO(exportTarget);
      downloadPOExport(po, { batchTitle });
      setExportTarget(null);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  /**
   * Open the Sage post dialog with this PO mapped to a bill draft — the same fields
   * the .csv would carry, as JSON. Every field stays editable and the dialog can
   * show the exact payload before it sends.
   */
  async function openPost(target: NormalizedPurchaseOrder) {
    setPosted(null);
    setError(null);
    setPreparing(target.id);
    try {
      const po = await freshReconciledPO(target);
      setPost({ draft: sageDraftFromInnergyPO(po), po });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to prepare the bill.");
    } finally {
      setPreparing(null);
    }
  }

  return (
    <div className="container">
      <header className="page-header">
        <h1>Innergy PO → Sage Intacct AP Bill</h1>
        <p>
          Send a reconciled purchase order to Sage Intacct — either straight through
          the API (<strong>Post to Sage</strong>) or as a .csv import file for the AP
          Bill template.
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
          Sent PO {posted.poNumber} to Sage — bill <strong>{posted.id}</strong>{" "}
          (record key {posted.key}) in entity {entity || "top level"}.{" "}
          {posted.submitted
            ? "Submitted, matching ACTION = Submit."
            : posted.submitError
              ? `Created, but the submit step failed: ${posted.submitError} — the bill is sitting in the draft queue.`
              : "Left in the draft queue."}
        </div>
      )}

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
                    <div className="head-actions">
                      <button
                        className="primary"
                        disabled={!po.isReconciled || preparing === po.id}
                        title={
                          po.isReconciled
                            ? "Push this PO into Sage as an AP bill through the API"
                            : "Only reconciled POs can be sent to Sage"
                        }
                        onClick={() => openPost(po)}
                      >
                        {preparing === po.id ? "Loading…" : "Post to Sage"}
                      </button>
                      <button
                        className="ghost"
                        disabled={!po.isReconciled}
                        title={
                          po.isReconciled
                            ? "Export to Sage Intacct AP Bill format"
                            : "Only reconciled POs can be exported"
                        }
                        onClick={() => openExport(po)}
                      >
                        Export .csv
                      </button>
                    </div>
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

      {post && (
        <PostBillDialog
          initialDraft={post.draft}
          entity={entity}
          sourceLabel={`Innergy PO ${post.po.poNumber}`}
          notices={postNotices(post.po)}
          onClose={() => setPost(null)}
          onPosted={(result) => {
            setPost(null);
            setPosted({ ...result, poNumber: post.po.poNumber });
          }}
        />
      )}
    </div>
  );
}

/**
 * Warnings specific to pushing an *Innergy* PO (the dialog raises its own about the
 * GL account and the blank due date).
 */
function postNotices(po: NormalizedPurchaseOrder): React.ReactNode[] {
  const notices: React.ReactNode[] = [];

  if (innergyPOUsesFallbackVendor(po)) {
    notices.push(
      <>
        <strong>Fallback vendor.</strong> {po.vendorName || "This vendor"} has no
        External Id in Innergy, so the bill posts to{" "}
        <code>{FALLBACK_VENDOR_ID}</code> — the same value the .csv would carry. Set
        the Sage vendor ID on the vendor&rsquo;s External Id field in Innergy to send
        the real one.
      </>
    );
  }

  if (!po.paymentTerms) {
    notices.push(
      <>
        <strong>No payment term.</strong> This PO has no <code>PaymentTerms</code> in
        Innergy, so neither a term nor a due date is sent and Sage applies the
        vendor&rsquo;s default. Type a due date above if a specific one is needed.
      </>
    );
  }

  return notices;
}
