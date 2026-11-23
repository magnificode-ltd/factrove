"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function copyToClipboard(value: string, message: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
    return true;
  } catch {
    toast.error("Could not copy. Select the text and copy it manually.");
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  message = "Copied to clipboard",
  iconOnly = false,
  className,
  labelClassName
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  message?: string;
  iconOnly?: boolean;
  className?: string;
  labelClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    };
  }, []);

  async function onCopy() {
    const copiedValue = await copyToClipboard(value, message);
    if (!copiedValue) {
      return;
    }
    setCopied(true);
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => {
      resetTimer.current = null;
      setCopied(false);
    }, 1800);
  }

  const visibleLabel = copied ? copiedLabel : label;
  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "secondary"}
      size={iconOnly ? "icon-sm" : "default"}
      className={cn(iconOnly ? "size-7 text-muted-foreground" : "h-10 bg-white px-3", className)}
      aria-label={iconOnly ? visibleLabel : undefined}
      onClick={() => void onCopy()}
    >
      <span className="ft-check" data-copied={copied ? "true" : "false"} aria-hidden="true">
        <Copy className="ft-check-off" />
        <Check className="ft-check-on" />
      </span>
      {iconOnly ? null : <span className={labelClassName}>{visibleLabel}</span>}
    </Button>
  );
}
