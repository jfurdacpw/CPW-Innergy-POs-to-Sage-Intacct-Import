import { NextResponse } from "next/server";
import { checkSageConnection, sageConfigSummary, SageError } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * Connection test: mints an access token and reports non-secret facts only
 * (expiry + which company/entity we are pointed at). The token itself is never
 * returned to the browser.
 */
export async function GET() {
  try {
    const status = await checkSageConnection();
    return NextResponse.json(status);
  } catch (err) {
    const status = err instanceof SageError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : "Sage connection test failed.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        details: err instanceof SageError ? err.details : undefined,
        config: sageConfigSummary(),
      },
      { status }
    );
  }
}
