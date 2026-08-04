import { NextResponse } from "next/server";
import {
  createSageInvoice,
  listSageInvoices,
  SageError,
  type SageInvoiceDraft,
} from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * List AR invoices straight out of Sage Intacct (read-only).
 * `?size=` caps how many records are pulled (default 100, max 200).
 * `?entity=` scopes the call to a sub-entity (10/20/30); blank = top level.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = Number(params.get("size"));
  const size = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;

  try {
    const result = await listSageInvoices(size, params.get("entity"));
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof SageError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to load Sage invoices.";
    return NextResponse.json(
      { error: message, details: err instanceof SageError ? err.details : undefined },
      { status }
    );
  }
}

/**
 * Create an AR invoice in Sage. **This writes to Sage** — a draft with
 * `state: "posted"` posts to the GL exactly as a CSV import does.
 *
 * Body: `{ entity?: string, draft: SageInvoiceDraft }`.
 */
export async function POST(request: Request) {
  let body: { entity?: string | null; draft?: SageInvoiceDraft };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body?.draft) {
    return NextResponse.json({ error: "Missing `draft`." }, { status: 400 });
  }

  try {
    const result = await createSageInvoice(body.draft, body.entity);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const status = err instanceof SageError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to create the Sage invoice.";
    return NextResponse.json(
      { error: message, details: err instanceof SageError ? err.details : undefined },
      { status }
    );
  }
}
