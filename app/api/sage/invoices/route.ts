import { NextResponse } from "next/server";
import { listSageInvoices, SageError } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * List AR invoices straight out of Sage Intacct (read-only).
 * `?size=` caps how many records are pulled (default 100, max 200).
 */
export async function GET(request: Request) {
  const sizeParam = new URL(request.url).searchParams.get("size");
  const parsed = Number(sizeParam);
  const size = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 100;

  try {
    const result = await listSageInvoices(size);
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
