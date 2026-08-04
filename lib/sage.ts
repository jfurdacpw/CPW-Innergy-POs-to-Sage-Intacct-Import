/**
 * Server-only Sage Intacct REST API v1 client.
 *
 * IMPORTANT: this module reads SAGE_CLIENT_SECRET and mints access tokens. It must
 * never be imported into a client component — only from route handlers under
 * app/api. Access tokens never leave the server.
 *
 * Auth: OAuth 2.0 client credentials (server-to-server). POST /oauth2/token with
 * client_id + client_secret + username ("wsUser@companyId"). Tokens last 12h; we
 * cache one in module memory and re-mint a minute before expiry.
 *
 * Which Sage company you hit is decided by the companyId inside SAGE_WS_USER, not
 * by the base URL — the implementation/sandbox company is a different companyId.
 */
import "server-only";

const BASE_URL = (
  process.env.SAGE_BASE_URL || "https://api.intacct.com/ia/api/v1"
).replace(/\/$/, "");

/** Optional sub-entity to scope every call to (sent as X-IA-API-Param-Entity). */
const ENTITY_ID = (process.env.SAGE_ENTITY_ID || "").trim();

export class SageError extends Error {
  status: number;
  /** Raw `ia::error` payload from Intacct, when it returned one. */
  details?: unknown;
  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "SageError";
    this.status = status;
    this.details = details;
  }
}

function env(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) {
    throw new SageError(
      `${name} is not set. Add it to .env.local (or the Vercel project env).`,
      500
    );
  }
  return v;
}

/** Public, non-secret view of how this client is configured (safe for the UI). */
export function sageConfigSummary() {
  const user = (process.env.SAGE_WS_USER || "").trim();
  const [userId, rest] = user.split("@");
  const [companyId] = (rest || "").split("|");
  return {
    baseUrl: BASE_URL,
    userId: userId || "",
    companyId: companyId || "",
    entityId: ENTITY_ID || null,
    configured: Boolean(
      process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET && user
    ),
  };
}

/* ------------------------------------------------------------------ *
 * Token handling
 * ------------------------------------------------------------------ */

let tokenCache: { token: string; expiresAt: number } | null = null;
const TOKEN_SKEW_MS = 60 * 1000;

/** Mint (or reuse) an access token. Returns the token plus its expiry. */
async function getToken(
  force = false
): Promise<{ token: string; expiresAt: number }> {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_SKEW_MS) {
    return tokenCache;
  }

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env("SAGE_CLIENT_ID"),
      client_secret: env("SAGE_CLIENT_SECRET"),
      username: env("SAGE_WS_USER"),
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new SageError(
      `Sage token request failed (${res.status}): ${describeError(text)}`,
      res.status,
      safeJson(text)
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new SageError("Sage token response was not JSON.", 502);
  }
  if (!payload?.access_token) {
    throw new SageError("Sage token response had no access_token.", 502, payload);
  }

  const expiresIn = Number(payload.expires_in) || 12 * 60 * 60;
  tokenCache = {
    token: payload.access_token as string,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return tokenCache;
}

/**
 * Verify credentials work. Returns only non-secret facts — never the token
 * itself, which must not reach the browser.
 */
export async function checkSageConnection(): Promise<{
  ok: true;
  expiresAt: string;
  config: ReturnType<typeof sageConfigSummary>;
}> {
  const { expiresAt } = await getToken();
  return {
    ok: true,
    expiresAt: new Date(expiresAt).toISOString(),
    config: sageConfigSummary(),
  };
}

/* ------------------------------------------------------------------ *
 * Request plumbing
 * ------------------------------------------------------------------ */

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Turn an Intacct error body into a readable one-liner. Intacct returns
 * `{"ia::error": { code, message, supportId, details: [{ code, message, ... }] }}`
 * and the useful sentence is usually inside `details[]`, so it is NOT truncated
 * here — the exact text is what makes these failures diagnosable.
 */
function describeError(text: string): string {
  const body = safeJson(text) as any;
  const err = body?.["ia::error"];
  if (!err) return text.slice(0, 1000);

  const parts: string[] = [];
  if (err.message) parts.push(String(err.message));
  for (const d of err.details || []) {
    const line = [d?.code, d?.message, d?.correction]
      .filter(Boolean)
      .join(" — ");
    if (line) parts.push(line);
  }
  if (err.supportId) parts.push(`supportId ${err.supportId}`);
  return parts.join(" | ") || text.slice(0, 1000);
}

type SageRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

/** Call the Sage REST API with a bearer token, retrying once on a 401. */
async function sageFetch<T>(path: string, init: SageRequest = {}): Promise<T> {
  const method = init.method || "GET";

  const send = async (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (ENTITY_ID) headers["X-IA-API-Param-Entity"] = ENTITY_ID;

    return fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  };

  let { token } = await getToken();
  let res = await send(token);

  // A stale cached token (revoked, or expired early) reads as a 401 — re-mint once.
  if (res.status === 401) {
    ({ token } = await getToken(true));
    res = await send(token);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new SageError(
      `Sage ${method} ${path} returned ${res.status}: ${describeError(text)}`,
      res.status,
      (safeJson(text) as any)?.["ia::error"] ?? safeJson(text)
    );
  }

  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SageError(`Sage ${method} ${path} returned invalid JSON.`, 502);
  }
}

/** `ia::result` is an object for single records and an array for lists. */
function resultList(payload: any): any[] {
  const result = payload?.["ia::result"];
  if (Array.isArray(result)) return result;
  if (result === null || result === undefined) return [];
  return [result];
}

/* ------------------------------------------------------------------ *
 * AR invoices
 * ------------------------------------------------------------------ */

export type SageInvoice = {
  key: string;
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  dueAmount: number;
  state: string;
};

/**
 * Fields requested from the query service. Field access is funneled through
 * normalizeSageInvoice below, so this list and that function are the only two
 * places to adjust if a name turns out to be wrong for our tenant.
 */
export const SAGE_INVOICE_QUERY_FIELDS = [
  "key",
  "id",
  "invoiceNumber",
  "customer.id",
  "customer.name",
  "invoiceDate",
  "dueDate",
  "totalTxnAmount",
  "totalDueTxnAmount",
  "state",
];

function str(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function num(value: any): number {
  if (typeof value === "number") return value;
  const n = parseFloat(str(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a raw Sage AR invoice (query row or detail record) to our display shape.
 * Query rows come back flat with dotted keys ("customer.id"); detail records come
 * back nested ({ customer: { id } }) — both are handled.
 */
export function normalizeSageInvoice(raw: any): SageInvoice {
  const pick = (...keys: string[]): any => {
    for (const k of keys) {
      const flat = raw?.[k];
      if (flat !== undefined && flat !== null && flat !== "") return flat;
      // Nested lookup for dotted keys ("customer.id" -> raw.customer.id).
      if (k.includes(".")) {
        const nested = k
          .split(".")
          .reduce((acc: any, part) => (acc == null ? acc : acc[part]), raw);
        if (nested !== undefined && nested !== null && nested !== "") return nested;
      }
    }
    return undefined;
  };

  return {
    key: str(pick("key", "recordNo")),
    id: str(pick("id", "recordNo", "key")),
    invoiceNumber: str(pick("invoiceNumber", "recordId", "documentNumber", "id")),
    customerId: str(pick("customer.id", "customerId")),
    customerName: str(pick("customer.name", "customerName")),
    invoiceDate: str(pick("invoiceDate", "createdDate")),
    dueDate: str(pick("dueDate")),
    totalAmount: num(pick("totalTxnAmount", "totalBaseAmount", "totalEntered")),
    dueAmount: num(pick("totalDueTxnAmount", "totalDueBaseAmount", "totalDue")),
    state: str(pick("state", "status")),
  };
}

/** Result of a list, plus which code path produced it (useful while verifying). */
export type SageInvoiceList = {
  invoices: SageInvoice[];
  /** "query" = /services/core/query; "detail" = list keys then GET each record. */
  source: "query" | "detail";
  /** Populated when the query service failed and we fell back to list+detail. */
  queryError?: string;
  raw: unknown;
};

const DEFAULT_PAGE_SIZE = 100;

/** List AR invoices via the query service (fields + filters + ordering). */
async function listInvoicesByQuery(size: number) {
  const payload = await sageFetch<any>("/services/core/query", {
    method: "POST",
    body: {
      object: "accounts-receivable/invoice",
      fields: SAGE_INVOICE_QUERY_FIELDS,
      orderBy: [{ invoiceDate: "desc" }],
      start: 1,
      size,
    },
  });
  return {
    invoices: resultList(payload).map(normalizeSageInvoice),
    raw: payload,
  };
}

/**
 * Fallback: GET the object list (which returns key/id/href only) and fetch each
 * record's detail. Needs zero field-name knowledge in the request, so it works
 * even if a query field name is wrong — but costs one call per invoice.
 */
async function listInvoicesByDetail(size: number) {
  const listing = await sageFetch<any>("/objects/accounts-receivable/invoice");
  const keys = resultList(listing)
    .map((r) => str(r?.key || r?.id))
    .filter(Boolean)
    .slice(0, size);

  const details = await Promise.all(
    keys.map((key) =>
      sageFetch<any>(
        `/objects/accounts-receivable/invoice/${encodeURIComponent(key)}`
      )
    )
  );

  return {
    invoices: details.flatMap((d) => resultList(d).map(normalizeSageInvoice)),
    raw: { listing, details },
  };
}

/**
 * List AR invoices out of Sage. Tries the query service first and falls back to
 * list+detail if it errors, reporting which path was used.
 */
export async function listSageInvoices(
  size = DEFAULT_PAGE_SIZE
): Promise<SageInvoiceList> {
  try {
    const { invoices, raw } = await listInvoicesByQuery(size);
    return { invoices, source: "query", raw };
  } catch (err) {
    const queryError =
      err instanceof Error ? err.message : "Query service call failed.";
    const { invoices, raw } = await listInvoicesByDetail(size);
    return { invoices, source: "detail", queryError, raw };
  }
}
