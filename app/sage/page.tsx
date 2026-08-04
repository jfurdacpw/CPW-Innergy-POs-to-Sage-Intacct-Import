"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SageInvoice, SageInvoiceList } from "@/lib/sage";
import {
  blankSageInvoiceDraft,
  type SageInvoiceDraft,
} from "@/lib/sageInvoiceDraft";
import PostInvoiceDialog from "./PostInvoiceDialog";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type Status = {
  ok: boolean;
  expiresAt?: string | null;
  error?: string;
  details?: unknown;
  config?: {
    baseUrl: string;
    authMode: string;
    userId: string;
    companyId: string;
    defaultEntityId: string | null;
    configured: boolean;
  };
};

/** Entity choices: top level plus the three sub-entities. */
const ENTITIES = [
  { value: "", label: "Top level (all entities)" },
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "30", label: "30" },
];

/** Dates come back as YYYY-MM-DD (or ISO) — show them as-is minus any time part. */
function shortDate(value: string): string {
  if (!value) return "—";
  return value.split("T")[0];
}

export default function SagePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);

  const [list, setList] = useState<SageInvoiceList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<unknown>(undefined);
  const [query, setQuery] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [entity, setEntity] = useState("20");

  // Post dialog: null = closed. `sourceLabel` says where the draft came from.
  const [post, setPost] = useState<{
    draft: SageInvoiceDraft;
    sourceLabel: string;
  } | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ key: string; id: string } | null>(null);

  /**
   * The picker seeds itself from the server's SAGE_ENTITY_ID so the two defaults
   * can't diverge — but only on the first status call, so re-testing the connection
   * never discards the entity the user picked. A ref, not state, to keep
   * checkConnection stable.
   */
  const entitySeeded = useRef(false);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/sage/status");
      const body: Status = await res.json();
      setStatus(body);
      if (!entitySeeded.current) {
        setEntity(body.config?.defaultEntityId ?? "");
        entitySeeded.current = true;
      }
    } catch (e) {
      setStatus({
        ok: false,
        error: e instanceof Error ? e.message : "Connection test failed.",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorDetails(undefined);
    try {
      const res = await fetch(
        `/api/sage/invoices?entity=${encodeURIComponent(entity)}`
      );
      const body = await res.json();
      if (!res.ok) {
        setErrorDetails(body.details);
        throw new Error(body.error || "Failed to load Sage invoices.");
      }
      setList(body as SageInvoiceList);
    } catch (e) {
      setList(null);
      setError(e instanceof Error ? e.message : "Failed to load Sage invoices.");
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  /**
   * Open the post dialog prefilled from an existing invoice. The detail record is
   * fetched fresh (the list query doesn't carry lines, accounts or dimensions).
   * The invoice number is left blank so Sage assigns a new one — reusing it is
   * rejected as a duplicate.
   */
  async function openClone(invoice: SageInvoice) {
    setCloning(invoice.key);
    setError(null);
    setErrorDetails(undefined);
    try {
      const res = await fetch(
        `/api/sage/invoices/${encodeURIComponent(invoice.key)}?entity=${encodeURIComponent(entity)}`
      );
      const body = await res.json();
      if (!res.ok) {
        setErrorDetails(body.details);
        throw new Error(body.error || "Failed to load that invoice.");
      }
      setPost({
        draft: { ...(body.draft as SageInvoiceDraft), invoiceNumber: "" },
        sourceLabel: `clone of ${invoice.invoiceNumber || `key ${invoice.key}`}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load that invoice.");
    } finally {
      setCloning(null);
    }
  }

  function openBlank() {
    setPost({ draft: blankSageInvoiceDraft(), sourceLabel: "manual entry" });
  }

  const invoices: SageInvoice[] = list?.invoices ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) =>
      [inv.invoiceNumber, inv.customerName, inv.customerId, inv.state, inv.id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [invoices, query]);

  return (
    <div className="container">
      <header className="page-header">
        <h1>Sage Intacct API (test)</h1>
        <p>
          Talks to the Sage Intacct REST API directly instead of generating a
          .csv. Read-only for now: verify the connection, then list AR invoices
          out of Sage. Posting invoices comes later.
        </p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>Connection</h2>
          <button className="ghost" onClick={checkConnection} disabled={checking}>
            {checking ? "Testing…" : "Test connection"}
          </button>
        </div>

        {!status ? (
          <div className="state">Checking credentials…</div>
        ) : (
          <>
            <div className="kv">
              <div>
                <label>Status</label>
                <span
                  className={`badge ${status.ok ? "reconciled" : "not-reconciled"}`}
                >
                  {status.ok ? "Token OK" : "Failed"}
                </span>
              </div>
              <div>
                <label>Auth mode</label>
                <span>
                  {status.config?.authMode === "pasted-token"
                    ? "Pasted token (12h)"
                    : "Client credentials"}
                </span>
              </div>
              <div>
                <label>Company</label>
                <span>{status.config?.companyId || "—"}</span>
              </div>
              <div>
                <label>Default entity</label>
                <span>{status.config?.defaultEntityId || "top level"}</span>
              </div>
              <div>
                <label>Token expires</label>
                <span>
                  {status.expiresAt
                    ? new Date(status.expiresAt).toLocaleString()
                    : status.ok
                      ? "unknown (pasted token)"
                      : "—"}
                </span>
              </div>
              <div>
                <label>Base URL</label>
                <span className="mono">{status.config?.baseUrl || "—"}</span>
              </div>
            </div>

            {!status.ok && (
              <>
                <div className="error">{status.error}</div>
                {status.details ? (
                  <pre className="raw">
                    {JSON.stringify(status.details, null, 2)}
                  </pre>
                ) : null}
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>AR invoices in Sage</h2>
          <div className="head-actions">
            <label className="inline-field">
              Entity
              <select
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                disabled={loading}
              >
                {ENTITIES.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={openBlank} disabled={loading}>
              New invoice
            </button>
            <button className="primary" onClick={loadInvoices} disabled={loading}>
              {loading ? "Loading…" : invoices.length ? "Refresh" : "Load invoices"}
            </button>
          </div>
        </div>

        {posted && (
          <div className="notice success">
            Posted to Sage — new invoice <strong>{posted.id}</strong> (record key{" "}
            {posted.key}) in entity {entity || "top level"}.{" "}
            <button className="link" onClick={loadInvoices}>
              Refresh the list
            </button>{" "}
            to see it.
          </div>
        )}

        {error && <div className="error">{error}</div>}
        {error && errorDetails ? (
          <pre className="raw">{JSON.stringify(errorDetails, null, 2)}</pre>
        ) : null}

        {list?.queryError && (
          <div className="notice">
            Query service call failed, fell back to list + per-record detail:{" "}
            {list.queryError}
          </div>
        )}

        {list && (
          <div className="toolbar">
            <input
              type="search"
              placeholder="Search invoice #, customer, state…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={showRaw}
                onChange={(e) => setShowRaw(e.target.checked)}
              />
              Show raw response
            </label>
            <span className="meta">
              {filtered.length} of {invoices.length} · via {list.source} · entity{" "}
              {list.entity || "top level"}
            </span>
          </div>
        )}

        {!list && !loading && !error ? (
          <div className="state">
            Nothing loaded yet — hit “Load invoices”.
          </div>
        ) : loading ? (
          <div className="state">Loading invoices from Sage…</div>
        ) : list && filtered.length === 0 ? (
          <div className="state">No invoices match.</div>
        ) : list ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th>State</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Record key</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.key || inv.id}>
                    <td>{inv.invoiceNumber || "—"}</td>
                    <td>
                      {inv.customerName || "—"}
                      {inv.customerId ? (
                        <span className="meta"> ({inv.customerId})</span>
                      ) : null}
                    </td>
                    <td>{shortDate(inv.invoiceDate)}</td>
                    <td>{shortDate(inv.dueDate)}</td>
                    <td>{inv.state || "—"}</td>
                    <td className="num">{currency.format(inv.totalAmount)}</td>
                    <td className="num">{currency.format(inv.dueAmount)}</td>
                    <td className="mono">{inv.key || "—"}</td>
                    <td>
                      <button
                        className="ghost"
                        onClick={() => openClone(inv)}
                        disabled={cloning !== null || !inv.key}
                        title="Open a new invoice prefilled from this one"
                      >
                        {cloning === inv.key ? "Loading…" : "Clone"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {showRaw && list ? (
          <pre className="raw">{JSON.stringify(list.raw, null, 2)}</pre>
        ) : null}
      </section>

      {post && (
        <PostInvoiceDialog
          initialDraft={post.draft}
          entity={entity}
          sourceLabel={post.sourceLabel}
          onClose={() => setPost(null)}
          onPosted={(result) => {
            setPost(null);
            setPosted(result);
            loadInvoices();
          }}
        />
      )}
    </div>
  );
}
