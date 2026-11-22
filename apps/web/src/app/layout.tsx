import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@/components/analytics";
import { DocsUrlProvider } from "@/components/docs-link";
import { SourceCodeUrlProvider } from "@/components/source-code-link";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { docsBaseUrl, publicConfigScript, sourceCodeUrl } from "@/public-config";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata = { title: "Factrove", description: "Local HTML artifact library" };

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn(sans.variable, mono.variable, "font-sans")}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: publicConfigScript() }} />
        <Analytics />
        <DocsUrlProvider url={docsBaseUrl()}>
          <SourceCodeUrlProvider url={sourceCodeUrl()}>{children}</SourceCodeUrlProvider>
        </DocsUrlProvider>
        <Toaster />
      </body>
    </html>
  );
}
