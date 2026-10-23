"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_SOURCE_CODE_URL } from "@/public-config";

const SourceCodeUrlContext = createContext(DEFAULT_SOURCE_CODE_URL);

export function SourceCodeUrlProvider({ url, children }: { url: string; children: ReactNode }) {
  return <SourceCodeUrlContext.Provider value={url}>{children}</SourceCodeUrlContext.Provider>;
}

export function SourceCodeLink({ className }: { className?: string }) {
  const url = useContext(SourceCodeUrlContext);
  return (
    <a href={url} className={className}>
      Source code
    </a>
  );
}
