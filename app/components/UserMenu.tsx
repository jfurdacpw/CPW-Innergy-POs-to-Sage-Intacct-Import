import { auth, signOut } from "@/auth";

/**
 * Shows who is signed in, with a sign-out button. Renders nothing when there is no
 * session, so it stays out of the way on the login page.
 */
export default async function UserMenu() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  return (
    <div className="user-menu">
      <span className="meta">{email}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button className="ghost" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
