import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <a href="/" className={cn("wm wm-mark", className)}>
      fac<b>t</b>rove
    </a>
  );
}
