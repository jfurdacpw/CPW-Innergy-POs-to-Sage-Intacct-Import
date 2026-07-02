import { NextResponse } from "next/server";
import { getPurchaseOrder, InnergyError } from "@/lib/innergy";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const po = await getPurchaseOrder(id);
    return NextResponse.json({ purchaseOrder: po });
  } catch (err) {
    const status = err instanceof InnergyError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to load purchase order.";
    return NextResponse.json({ error: message }, { status });
  }
}
