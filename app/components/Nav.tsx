"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const TABS = [
  { href: "/", label: "Bills (AP)" },
  { href: "/invoices", label: "Invoices (AR)" },
  { href: "/sage", label: "Sage API (test)" },
];

/** `userSlot` is the server-rendered signed-in indicator (see UserMenu). */
export default function Nav({ userSlot }: { userSlot?: ReactNode }) {
  const pathname = usePathname();

  // No tab bar on the login page — there is nothing signed-in to navigate yet.
  if (pathname === "/login") return null;

  return (
    <nav className="tabnav">
      <div className="tabnav-inner">
        <span className="brand">Innergy → Sage Intacct</span>
        <div className="tabs">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={active ? "tab active" : "tab"}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        {userSlot}
      </div>
    </nav>
  );
}
