import { NextResponse } from "next/server";
import { listInvoices, InnergyError } from "@/lib/innergy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const invoices = await listInvoices();
    return NextResponse.json({ invoices });
  } catch (err) {
    const status = err instanceof InnergyError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to load invoices.";
    return NextResponse.json({ error: message }, { status });
  }
}
