import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Factrove", description: "Local HTML artifact library" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
