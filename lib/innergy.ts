/**
 * Server-only Innergy API client.
 *
 * IMPORTANT: this module reads INNERGY_API_KEY and must never be imported into a
 * client component. It is only used from route handlers under app/api.
 *
 * Auth: Innergy uses the header `Api-Key: <raw key>` — NOT Authorization/Bearer.
 * Gotcha: unknown routes / bad auth can return the SPA HTML shell with HTTP 200,
 * so any non-JSON response is treated as an error.
 */
import "server-only";
import type { NormalizedPurchaseOrder } from "./sageColumns";
import type { NormalizedInvoice } from "./arColumns";

const BASE_URL = process.env.INNERGY_BASE_URL || "https://app.innergy.com";

export class InnergyError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "InnergyError";
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.INNERGY_API_KEY;
  if (!key) {
    throw new InnergyError(
      "INNERGY_API_KEY is not set. Add it to .env.local (or the Vercel project env).",
      500
    );
  }
  return key;
}

async function innergyGet<T>(path: string): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      "Api-Key": apiKey(),
      Accept: "application/json",
      // A browser-like UA helps Innergy return JSON instead of the app shell.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    cache: "no-store",
  });

  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    throw new InnergyError(
      `Innergy ${path} returned ${res.status}: ${text.slice(0, 200)}`,
      res.status
    );
  }

  // Non-JSON (e.g. the SPA HTML shell) => treat as an auth/route error.
  if (!contentType.includes("application/json") && !looksLikeJson(text)) {
    throw new InnergyError(
      `Innergy ${path} returned a non-JSON response (likely an auth or permission problem).`,
      502
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InnergyError(`Innergy ${path} returned invalid JSON.`, 502);
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/* ------------------------------------------------------------------ *
 * Raw response typing is intentionally loose (`any`) because the exact
 * Innergy PO field names are confirmed against live data during setup.
 * All field access is funneled through the normalizers below so there
 * is exactly one place to adjust when the real names are known.
 * ------------------------------------------------------------------ */

/**
 * Pull the array of PO records out of the Innergy envelope.
 * The list endpoint returns `{ CreateDate, Items: [...] }`.
 */
function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  return payload?.Items || [];
}

/** Trim a string, treating whitespace-only (e.g. " ") as empty. */
function cleanStr(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Extract a number from an Innergy money object `{ Value, OriginalValue,
 * CurrencyCode }`, or a plain number/string.
 */
function moneyValue(value: any): number {
  if (value && typeof value === "object" && "Value" in value) {
    const n = Number(value.Value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Extract a display project name from the PO's `Projects` field, which may be
 * null, an array of strings, or an array of `{ Name }` objects.
 */
function projectName(raw: any): string | undefined {
  const projects = raw?.Projects;
  if (!Array.isArray(projects) || projects.length === 0) return undefined;
  const names = projects
    .map((p) => (typeof p === "string" ? p : p?.Name || p?.name))
    .filter(Boolean);
  return names.length ? names.join(", ") : undefined;
}

/**
 * Map a raw Innergy PO object to our normalized shape.
 * Field names verified against a live `GET /api/purchaseOrders` response (2026-07).
 */
export function normalizePO(raw: any): NormalizedPurchaseOrder {
  const status = cleanStr(raw?.Status);
  const number = cleanStr(raw?.Number);

  return {
    // Detail lookups use the PO Number (e.g. "PO-100002"), NOT the UUID Id.
    id: number,
    poNumber: number,
    vendorExternalId: cleanStr(raw?.VendorExternalIdentifier),
    vendorName: cleanStr(raw?.Vendor),
    vendorContact: cleanStr(raw?.VendorContactName),
    paymentTerms: cleanStr(raw?.PaymentTerms),
    receivedTotalCost: moneyValue(raw?.ReceivedTotalCost),
    isReconciled: status.toLowerCase() === "reconciled",
    status,
    projectName: projectName(raw),
  };
}

export async function listPurchaseOrders(): Promise<NormalizedPurchaseOrder[]> {
  const payload = await innergyGet<any>("/api/purchaseOrders");
  return extractList(payload).map(normalizePO);
}

export async function getPurchaseOrder(
  poNumber: string
): Promise<NormalizedPurchaseOrder> {
  // The detail endpoint keys off the PO Number and returns the record directly.
  const payload = await innergyGet<any>(
    `/api/purchaseOrders/${encodeURIComponent(poNumber)}`
  );
  return normalizePO(payload);
}

/* ------------------------------------------------------------------ *
 * Invoices (AR)
 * ------------------------------------------------------------------ */

/**
 * Cached map of lower-cased company name -> ExternalIdentifier, built from
 * /api/companies. Used to resolve a customer's External Id (the Sage customer ID)
 * from the invoice's customer NAME, since the invoice record has no external id.
 *
 * Only names WITH a non-empty ExternalIdentifier are added, so today the map is
 * empty and CUSTOMER_ID exports blank; once Sage IDs are set on customers in
 * Innergy, the same lookup starts populating CUSTOMER_ID automatically.
 */
let companiesCache: { at: number; map: Map<string, string> } | null = null;
const COMPANIES_TTL_MS = 5 * 60 * 1000;

async function getCustomerExternalIdMap(): Promise<Map<string, string>> {
  if (companiesCache && Date.now() - companiesCache.at < COMPANIES_TTL_MS) {
    return companiesCache.map;
  }
  const payload = await innergyGet<any>("/api/companies");
  const map = new Map<string, string>();
  for (const c of payload?.Items || []) {
    const name = cleanStr(c?.Name).toLowerCase();
    const ext = cleanStr(c?.ExternalIdentifier);
    if (name && ext) map.set(name, ext);
  }
  companiesCache = { at: Date.now(), map };
  return map;
}

/**
 * Map a raw Innergy invoice (from a project group's `Items`) to our normalized
 * shape. Field names verified against a live `GET /api/invoices` response (2026-07).
 */
export function normalizeInvoice(
  raw: any,
  project: any,
  custMap: Map<string, string>
): NormalizedInvoice {
  const customerName = cleanStr(raw?.Customer);
  const workOrderNumbers = Array.isArray(raw?.WorkOrders)
    ? raw.WorkOrders.map((w: any) => cleanStr(w?.Number)).filter(Boolean)
    : [];

  return {
    id: cleanStr(raw?.InvoiceNumber),
    invoiceNumber: cleanStr(raw?.InvoiceNumber),
    customerName,
    customerExternalId: custMap.get(customerName.toLowerCase()) || "",
    projectName: cleanStr(project?.ProjectName) || undefined,
    projectNumber: cleanStr(project?.ProjectNumber) || undefined,
    workOrderNumbers,
    invoiceAmount: moneyValue(raw?.InvoiceAmount),
    dueDate: cleanStr(raw?.DueDate),
    status: cleanStr(raw?.Status),
  };
}

export async function listInvoices(): Promise<NormalizedInvoice[]> {
  // /api/invoices returns { Items: [ { Project, ...totals, Items: [invoice...] } ] }
  // i.e. invoices are grouped by project; flatten to a single list.
  const [payload, custMap] = await Promise.all([
    innergyGet<any>("/api/invoices"),
    getCustomerExternalIdMap(),
  ]);

  const groups: any[] = payload?.Items || [];
  const out: NormalizedInvoice[] = [];
  for (const group of groups) {
    const project = group?.Project || {};
    for (const raw of group?.Items || []) {
      out.push(normalizeInvoice(raw, project, custMap));
    }
  }
  return out;
}
