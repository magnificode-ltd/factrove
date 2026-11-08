import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export const uploadCommand = "factrove upload plan.html";

export function CliTerminal({ command = uploadCommand, className }: { command?: string; className?: string }) {
  return (
    <div className={cn("ft-term w-full max-w-md", className)} aria-hidden="true">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-[var(--term-red)]" />
        <span className="size-2.5 rounded-full bg-[var(--term-yellow)]" />
        <span className="size-2.5 rounded-full bg-[var(--term-green)]" />
        <span className="ml-2 font-mono text-[11px] tracking-wide text-[color-mix(in_srgb,var(--cloud)_72%,var(--ink))]">
          zsh
        </span>
      </div>
      <p className="px-4 pt-1 pb-4 font-mono text-sm leading-none">
        <span className="text-peri">$ </span>
        <span
          className="ft-type"
          style={
            {
              "--ft-chars": String(command.length),
              animationTimingFunction: `steps(${command.length}, end), step-end`,
            } as CSSProperties
          }
        >
          {command}
        </span>
      </p>
    </div>
  );
}
