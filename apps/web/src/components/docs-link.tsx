"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_DOCS_BASE_URL } from "@/public-config";

const DocsUrlContext = createContext(DEFAULT_DOCS_BASE_URL);

export function DocsUrlProvider({ url, children }: { url: string; children: ReactNode }) {
  return <DocsUrlContext.Provider value={url}>{children}</DocsUrlContext.Provider>;
}

export function DocsLink({ className }: { className?: string }) {
  const url = useContext(DocsUrlContext);
  return (
    <a href={url} className={className} target="_blank" rel="noopener noreferrer">
      Docs
    </a>
  );
}
