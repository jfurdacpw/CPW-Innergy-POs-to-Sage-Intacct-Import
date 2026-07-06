"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Bills (AP)" },
  { href: "/invoices", label: "Invoices (AR)" },
];

export default function Nav() {
  const pathname = usePathname();
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
      </div>
    </nav>
  );
}
