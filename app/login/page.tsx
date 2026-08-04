import { signIn } from "@/auth";
import { ALLOWED_EMAILS } from "@/lib/authAllowlist";

/**
 * Sign-in page. `?error=AccessDenied` means Entra authenticated the person fine but
 * their address isn't on the allowlist — say so plainly rather than looping them back
 * to a bare login button.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;
  const denied = error === "AccessDenied";

  return (
    <div className="container login-wrap">
      <div className="card login-card">
        <h1>Innergy → Sage Intacct</h1>
        <p className="hint">
          Internal tool. Sign in with your Cider Press Microsoft account.
        </p>

        {denied && (
          <div className="error">
            <strong>Not authorized.</strong> That Microsoft account signed in
            successfully, but it isn’t on this app’s access list. Ask Jason to add
            it if you need access.
          </div>
        )}

        {error && !denied && (
          <div className="error">
            Sign-in failed ({error}). Try again, or send this code to Jason.
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", {
              redirectTo: from && from.startsWith("/") ? from : "/",
            });
          }}
        >
          <button className="primary login-button" type="submit">
            Sign in with Microsoft
          </button>
        </form>

        <p className="meta login-note">
          {ALLOWED_EMAILS.length} accounts have access.
        </p>
      </div>
    </div>
  );
}
