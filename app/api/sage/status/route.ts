import { NextResponse } from "next/server";
import { checkSageConnection, sageConfigSummary, SageError } from "@/lib/sage";

export const dynamic = "force-dynamic";

/**
 * Connection test: mints an access token, proves it with a real API call, and
 * reports non-secret facts only (expiry + which company/entity we are pointed at).
 * The token itself is never returned to the browser.
 *
 * `?config=1` skips the token and the probe entirely and returns just the config
 * summary, which reads env vars and nothing else. The Invoices tab uses that to seed
 * its entity picker — a page whose main workflow is a .csv download must not spend a
 * Sage round-trip (or surface a token error) on every load.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("config") === "1") {
    return NextResponse.json({ ok: true, config: sageConfigSummary() });
  }

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
