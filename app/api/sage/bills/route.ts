import { NextResponse } from "next/server";
import { createSageBill, SageError, type SageBillDraft } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * Create an AP bill in Sage. **This writes to Sage** — the same bill the AP Bill
 * .csv import would create, sent straight through the API. With
 * `draft.action = "submit"` it is also submitted afterwards, matching the .csv's
 * `ACTION = "Submit"` column.
 *
 * Body: `{ entity?: string, draft: SageBillDraft }`.
 */
export async function POST(request: Request) {
  let body: { entity?: string | null; draft?: SageBillDraft };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body?.draft) {
    return NextResponse.json({ error: "Missing `draft`." }, { status: 400 });
  }

  try {
    const result = await createSageBill(body.draft, body.entity);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const status = err instanceof SageError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Failed to create the Sage bill.";
    return NextResponse.json(
      { error: message, details: err instanceof SageError ? err.details : undefined },
      { status }
    );
  }
}
