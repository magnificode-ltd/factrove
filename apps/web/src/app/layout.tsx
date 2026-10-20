import type { ReactNode } from "react";
import { Fraunces, Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display"
});

export const metadata = { title: "Factrove", description: "Local HTML artifact library" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn(sans.variable, display.variable, "font-sans")}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
