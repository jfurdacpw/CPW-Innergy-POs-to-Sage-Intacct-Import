import { NextResponse } from "next/server";
import { getSageInvoiceDetail, sageInvoiceDraftFromDetail, SageError } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * One invoice's full detail record, plus a draft prefilled from it — what the
 * "Clone" button needs to open its dialog with every field already populated.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const entity = new URL(request.url).searchParams.get("entity");

  try {
    const detail = await getSageInvoiceDetail(key, entity);
    if (!detail) {
      return NextResponse.json(
        { error: `No Sage invoice with key ${key} in that entity.` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      detail,
      draft: sageInvoiceDraftFromDetail(detail),
    });
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
