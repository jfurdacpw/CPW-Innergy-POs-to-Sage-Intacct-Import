/**
 * Server-only Sage Intacct REST API v1 client.
 *
 * IMPORTANT: this module reads SAGE_CLIENT_SECRET / SAGE_ACCESS_TOKEN. It must
 * never be imported into a client component — only from route handlers under
 * app/api. Access tokens never leave the server.
 *
 * Auth, two modes:
 *  1. SAGE_ACCESS_TOKEN set — use that token as-is. This is the current setup: our
 *     registered app uses the user-facing authorization-code workflow, so the token
 *     is minted by hand (Postman) and pasted in. Intacct tokens last 12h, so this
 *     needs re-pasting; the browser-login flow replaces it.
 *  2. Otherwise, client credentials: POST /oauth2/token with client_id +
 *     client_secret + username ("wsUser@companyId"), cached in module memory and
 *     re-minted a minute before expiry. Needs a Web Services user, which does not
 *     exist yet.
 *
 * Which Sage company you hit is decided by the companyId (implementation company is
 * `ciderpresswoodworks-imp`), not by the base URL.
 */
import "server-only";
import {
  sageInvoicePayload,
  validateSageInvoiceDraft,
  type SageInvoiceDraft,
} from "./sageInvoiceDraft";

const BASE_URL = (
  process.env.SAGE_BASE_URL || "https://api.intacct.com/ia/api/v1"
).replace(/\/$/, "");

/** Hand-pasted access token (see mode 1 above). Empty string when unset. */
const STATIC_TOKEN = (process.env.SAGE_ACCESS_TOKEN || "").trim();

/** Default sub-entity when a request doesn't name one. Blank = top level. */
const DEFAULT_ENTITY_ID = (process.env.SAGE_ENTITY_ID || "").trim();

/**
 * Entities that may be targeted per request. "" is the top level (all entities,
 * which the query service returns when includePrivate is true).
 */
export const SAGE_ENTITY_OPTIONS = ["", "10", "20", "30"] as const;
export type SageEntity = (typeof SAGE_ENTITY_OPTIONS)[number];

/**
 * Header that scopes a request to one entity. Verified live (2026-08): this name
 * works (entity 10 → 0 invoices, 20 → 8, 30 → 2, no header → all 10), while
 * `Sage-Param-Entity` is accepted and then silently ignored — every entity value
 * returns the full top-level set. Getting this wrong looks like success.
 */
const ENTITY_HEADER = "X-IA-API-Param-Entity";

/** Normalize a requested entity to one of the allowed values. */
export function resolveEntity(requested?: string | null): string {
  const value = (requested ?? DEFAULT_ENTITY_ID).trim();
  return (SAGE_ENTITY_OPTIONS as readonly string[]).includes(value) ? value : "";
}

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
  // Full form is userId@companyId[|entityId]. A value with no "@" is just a company
  // id (which is all we have while running on a pasted token).
  const [left, right] = user.includes("@") ? user.split("@") : ["", user];
  const [companyId] = (right || "").split("|");
  const authMode = STATIC_TOKEN ? "pasted-token" : "client-credentials";
  return {
    baseUrl: BASE_URL,
    authMode,
    userId: left || "",
    companyId: companyId || "",
    defaultEntityId: DEFAULT_ENTITY_ID || null,
    configured: STATIC_TOKEN
      ? true
      : Boolean(process.env.SAGE_CLIENT_ID && process.env.SAGE_CLIENT_SECRET && user),
  };
}

/* ------------------------------------------------------------------ *
 * Token handling
 * ------------------------------------------------------------------ */

let tokenCache: { token: string; expiresAt: number } | null = null;
const TOKEN_SKEW_MS = 60 * 1000;

type Token = { token: string; expiresAt: number | null };

/**
 * Get an access token: the pasted one if SAGE_ACCESS_TOKEN is set, otherwise mint
 * (or reuse) one via client credentials. A pasted token has no known expiry — it
 * simply starts returning 401 once its 12h is up.
 */
async function getToken(force = false): Promise<Token> {
  if (STATIC_TOKEN) return { token: STATIC_TOKEN, expiresAt: null };

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
 * Verify auth works. Returns only non-secret facts — never the token itself,
 * which must not reach the browser. A pasted token is proved by an actual API
 * call (there is nothing to mint), so this hits the cheap object-model endpoint.
 */
export async function checkSageConnection(): Promise<{
  ok: true;
  expiresAt: string | null;
  config: ReturnType<typeof sageConfigSummary>;
}> {
  const { expiresAt } = await getToken();
  if (STATIC_TOKEN) {
    await sageFetch("/services/core/model?name=accounts-receivable%2Finvoice");
  }
  return {
    ok: true,
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
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
 * Pull the `ia::error` object out of a response body. It sits at the top level on
 * some failures and nested under `ia::result` on others (the query service does the
 * latter), so both are checked — miss one and the readable message is lost.
 */
function extractError(body: any): any {
  return body?.["ia::error"] ?? body?.["ia::result"]?.["ia::error"];
}

/**
 * Turn an Intacct error body into a readable one-liner. The useful sentence is
 * usually inside `details[]` (e.g. "The totalDueTxnAmount field does not exist"),
 * so it is NOT truncated here — the exact text is what makes failures diagnosable.
 */
function describeError(text: string): string {
  const err = extractError(safeJson(text));
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
  /** Sub-entity to scope this call to. Blank/undefined = top level. */
  entity?: string;
};

/** Call the Sage REST API with a bearer token, retrying once on a 401. */
async function sageFetch<T>(path: string, init: SageRequest = {}): Promise<T> {
  const method = init.method || "GET";
  const entity = (init.entity ?? DEFAULT_ENTITY_ID).trim();

  const send = async (token: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (entity) headers[ENTITY_HEADER] = entity;

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
  // A pasted token can't be re-minted, so say so instead of retrying pointlessly.
  if (res.status === 401) {
    if (STATIC_TOKEN) {
      throw new SageError(
        "Sage rejected the access token (401). SAGE_ACCESS_TOKEN is likely past its 12h " +
          "life — mint a fresh one and update .env.local.",
        401
      );
    }
    ({ token } = await getToken(true));
    res = await send(token);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new SageError(
      `Sage ${method} ${path} returned ${res.status}: ${describeError(text)}`,
      res.status,
      extractError(safeJson(text)) ?? safeJson(text)
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
  referenceNumber: string;
  description: string;
  state: string;
};

/**
 * Fields requested from the query service, verified against the imp company via
 * `GET /services/core/model?name=accounts-receivable/invoice` (2026-08).
 *
 * `customer` is a ref, not a scalar field — it does not appear in the model's
 * field list and is pulled with dot notation, which comes back as flat dotted keys
 * ("customer.id"). Amount fields are `totalTxnAmount` / `totalTxnAmountDue` (there
 * is no `totalDueTxnAmount`), and they arrive as strings.
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
  "totalTxnAmountDue",
  "referenceNumber",
  "description",
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
    key: str(pick("key")),
    id: str(pick("id", "key")),
    invoiceNumber: str(pick("invoiceNumber", "documentId", "id")),
    customerId: str(pick("customer.id", "customerId")),
    customerName: str(pick("customer.name", "customerName")),
    invoiceDate: str(pick("invoiceDate")),
    dueDate: str(pick("dueDate")),
    totalAmount: num(pick("totalTxnAmount", "totalBaseAmount")),
    dueAmount: num(pick("totalTxnAmountDue", "totalBaseAmountDue")),
    referenceNumber: str(pick("referenceNumber")),
    description: str(pick("description")),
    state: str(pick("state")),
  };
}

/** Result of a list, plus which code path produced it (useful while verifying). */
export type SageInvoiceList = {
  invoices: SageInvoice[];
  /** "query" = /services/core/query; "detail" = list keys then GET each record. */
  source: "query" | "detail";
  /** Populated when the query service failed and we fell back to list+detail. */
  queryError?: string;
  entity: string;
  raw: unknown;
};

/** Query service default is 100 and the max is 4000 — always set it explicitly. */
const DEFAULT_PAGE_SIZE = 100;

/**
 * List AR invoices via the query service — the endpoint that does ~98% of the work
 * in this API, since object list endpoints return IDs only.
 *
 * `start` is 1-indexed. `caseSensitiveComparison` and `includePrivate` are RKL's
 * recommended defaults (includePrivate pulls entity-level records when querying
 * from the top level) and must sit inside `filterParameters` — at the top level the
 * API rejects them: "Unrecognized key includePrivate in query payload".
 */
async function listInvoicesByQuery(size: number, entity: string) {
  const payload = await sageFetch<any>("/services/core/query", {
    method: "POST",
    entity,
    body: {
      object: "accounts-receivable/invoice",
      fields: SAGE_INVOICE_QUERY_FIELDS,
      orderBy: [{ invoiceDate: "desc" }],
      filterParameters: {
        caseSensitiveComparison: false,
        includePrivate: true,
      },
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
async function listInvoicesByDetail(size: number, entity: string) {
  const listing = await sageFetch<any>("/objects/accounts-receivable/invoice", {
    entity,
  });
  const keys = resultList(listing)
    .map((r) => str(r?.key || r?.id))
    .filter(Boolean)
    .slice(0, size);

  const details = await Promise.all(
    keys.map((key) =>
      sageFetch<any>(
        `/objects/accounts-receivable/invoice/${encodeURIComponent(key)}`,
        { entity }
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
  size = DEFAULT_PAGE_SIZE,
  entityInput?: string | null
): Promise<SageInvoiceList> {
  const entity = resolveEntity(entityInput);
  try {
    const { invoices, raw } = await listInvoicesByQuery(size, entity);
    return { invoices, source: "query", entity, raw };
  } catch (err) {
    const queryError =
      err instanceof Error ? err.message : "Query service call failed.";
    const { invoices, raw } = await listInvoicesByDetail(size, entity);
    return { invoices, source: "detail", queryError, entity, raw };
  }
}

/**
 * Every queryable field on an object, straight from Sage. This is how field names
 * get confirmed instead of guessed (e.g. name=accounts-receivable/invoice).
 */
export async function getSageObjectModel(name: string): Promise<unknown> {
  return sageFetch(`/services/core/model?name=${encodeURIComponent(name)}`);
}

/* ------------------------------------------------------------------ *
 * Creating AR invoices (clone an existing one, or enter one by hand)
 * ------------------------------------------------------------------ */

/**
 * Draft shape, payload builder and validation live in lib/sageInvoiceDraft.ts so
 * the browser can preview the exact JSON this module posts — one implementation,
 * no drift between preview and request.
 */
export type {
  SageInvoiceDraft,
  SageInvoiceLineDraft,
} from "./sageInvoiceDraft";
export {
  blankSageInvoiceDraft,
  sageInvoiceDraftFromDetail,
  sageInvoicePayload,
  validateSageInvoiceDraft,
} from "./sageInvoiceDraft";
import { sageInvoiceDraftFromDetail } from "./sageInvoiceDraft";

/** Fetch one invoice's full detail record (used to prefill a clone). */
export async function getSageInvoiceDetail(
  key: string,
  entityInput?: string | null
): Promise<any> {
  const payload = await sageFetch<any>(
    `/objects/accounts-receivable/invoice/${encodeURIComponent(key)}`,
    { entity: resolveEntity(entityInput) }
  );
  return resultList(payload)[0] ?? null;
}

/**
 * Fields pulled for each line of an invoice. `dimensions.*` dotted paths work here
 * (verified live); the bare `department.id` form does not.
 */
export const SAGE_INVOICE_LINE_QUERY_FIELDS = [
  "key",
  "id",
  "lineNumber",
  "txnAmount",
  "memo",
  "isSubtotal",
  "glAccount.id",
  "overrideOffsetGLAccount.id",
  "accountLabel.id",
  "dimensions.department.id",
  "dimensions.location.id",
  "dimensions.project.id",
];

/**
 * Every line of an invoice, via the query service — **including subtotal rows**.
 *
 * This matters: `GET /objects/accounts-receivable/invoice/{key}` omits subtotal
 * lines from its `lines` array. Invoice 24 (RKL's manually-entered IN-1002) returns
 * a single 1300.00 entry line from the detail endpoint while the query service shows
 * both it and the 78.00 `isSubtotal: "subtotal"` tax row that makes up its 1378.00
 * total. Cloning from the detail record alone silently drops the tax.
 */
export async function listSageInvoiceLines(
  invoiceId: string,
  entityInput?: string | null
): Promise<any[]> {
  const payload = await sageFetch<any>("/services/core/query", {
    method: "POST",
    entity: resolveEntity(entityInput),
    body: {
      object: "accounts-receivable/invoice-line",
      fields: SAGE_INVOICE_LINE_QUERY_FIELDS,
      filters: [{ $eq: { "invoice.id": str(invoiceId) } }],
      filterParameters: { caseSensitiveComparison: false, includePrivate: true },
      orderBy: [{ lineNumber: "asc" }],
      start: 1,
      size: 200,
    },
  });
  return resultList(payload);
}

/**
 * Everything the clone dialog needs: the header record plus every line (subtotals
 * included), already mapped to an editable draft.
 */
export async function getSageInvoiceForClone(
  key: string,
  entityInput?: string | null
): Promise<{ detail: any; lines: any[]; draft: SageInvoiceDraft } | null> {
  const detail = await getSageInvoiceDetail(key, entityInput);
  if (!detail) return null;

  // A failure here must not lose the clone — fall back to the detail's own lines,
  // which are correct for invoices that have no subtotal rows.
  let lines: any[] = [];
  try {
    lines = await listSageInvoiceLines(str(detail?.id) || key, entityInput);
  } catch {
    lines = [];
  }

  return {
    detail,
    lines,
    draft: sageInvoiceDraftFromDetail(detail, lines),
  };
}

export type SageCreateResult = {
  key: string;
  id: string;
  entity: string;
  payload: Record<string, unknown>;
  raw: unknown;
};

/**
 * POST a new AR invoice. This WRITES to Sage — with state "posted" it hits the GL
 * exactly as a CSV import would, so it is only reachable from the signed-in Sage
 * test tab.
 */
export async function createSageInvoice(
  draft: SageInvoiceDraft,
  entityInput?: string | null
): Promise<SageCreateResult> {
  const problems = validateSageInvoiceDraft(draft);
  if (problems.length) {
    throw new SageError(problems.join(" "), 400);
  }

  const entity = resolveEntity(entityInput);
  const payload = sageInvoicePayload(draft);
  const response = await sageFetch<any>("/objects/accounts-receivable/invoice", {
    method: "POST",
    entity,
    body: payload,
  });

  const created = resultList(response)[0] ?? {};
  return {
    key: str(created?.key),
    id: str(created?.id),
    entity,
    payload,
    raw: response,
  };
}
