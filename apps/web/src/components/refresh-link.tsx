"use client";

import { RefreshCw } from "lucide-react";
import { Tooltip } from "radix-ui";

export function RefreshLink({ href }: { href: string }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <a
            href={href}
            aria-label="Refresh"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-lilac hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </a>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={6}
            className="z-50 rounded-md bg-ink px-2 py-1 text-xs font-medium text-white"
          >
            Refresh
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
