"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { DEFAULT_SOURCE_CODE_URL } from "@/public-config";

const SourceCodeUrlContext = createContext(DEFAULT_SOURCE_CODE_URL);

export function SourceCodeUrlProvider({ url, children }: { url: string; children: ReactNode }) {
  return <SourceCodeUrlContext.Provider value={url}>{children}</SourceCodeUrlContext.Provider>;
}

export function SourceCodeLink({ className, ...props }: ComponentProps<"a">) {
  const url = useContext(SourceCodeUrlContext);
  return (
    <a {...props} href={url} className={className}>
      Source code
    </a>
  );
}
