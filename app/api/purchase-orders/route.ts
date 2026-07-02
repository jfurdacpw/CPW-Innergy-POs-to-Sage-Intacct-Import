import { NextResponse } from "next/server";
import { listPurchaseOrders, InnergyError } from "@/lib/innergy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pos = await listPurchaseOrders();
    return NextResponse.json({ purchaseOrders: pos });
  } catch (err) {
    const status = err instanceof InnergyError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to load purchase orders.";
    return NextResponse.json({ error: message }, { status });
  }
}
