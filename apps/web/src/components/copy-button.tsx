"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  message = "Copied to clipboard",
  className
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  message?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(message);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("h-10 bg-white px-3", className)}
      onClick={() => void onCopy()}
    >
      <span className="ft-check" data-copied={copied ? "true" : "false"} aria-hidden="true">
        <Copy className="ft-check-off" />
        <Check className="ft-check-on" />
      </span>
      {copied ? copiedLabel : label}
    </Button>
  );
}
