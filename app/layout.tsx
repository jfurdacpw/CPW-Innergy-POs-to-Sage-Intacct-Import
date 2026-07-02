import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Innergy PO → Sage Intacct Exporter",
  description: "Export Innergy purchase orders to the Sage Intacct AP Bill import format.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
