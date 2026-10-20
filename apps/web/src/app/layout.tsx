import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata = { title: "Factrove", description: "Local HTML artifact library" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn(sans.variable, mono.variable, "font-sans")}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
