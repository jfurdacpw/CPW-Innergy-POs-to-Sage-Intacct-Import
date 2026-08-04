import type { Metadata } from "next";
import "./globals.css";
import Nav from "./components/Nav";
import UserMenu from "./components/UserMenu";

export const metadata: Metadata = {
  title: "Innergy → Sage Intacct Exporter",
  description:
    "Export Innergy purchase orders and invoices to the Sage Intacct AP Bill / AR Invoice import formats.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Nav userSlot={<UserMenu />} />
        {children}
      </body>
    </html>
  );
}
