import { NextResponse } from "next/server";
import { listSageInvoices, SageError } from "@/lib/sage";

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
