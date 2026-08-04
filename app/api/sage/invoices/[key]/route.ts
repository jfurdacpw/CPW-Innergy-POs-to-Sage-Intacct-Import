import { NextResponse } from "next/server";
import { getSageInvoiceForClone, SageError } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * One invoice's detail record, its lines (subtotal rows included — the detail
 * endpoint hides those), and a draft prefilled from both. This is what the "Clone"
 * button needs to open its dialog fully populated.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const entity = new URL(request.url).searchParams.get("entity");

  try {
    const result = await getSageInvoiceForClone(key, entity);
    if (!result) {
      return NextResponse.json(
        { error: `No Sage invoice with key ${key} in that entity.` },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof SageError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to load the Sage invoice.";
    return NextResponse.json(
      { error: message, details: err instanceof SageError ? err.details : undefined },
      { status }
    );
  }
}
