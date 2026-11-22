import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <a href="/" className={cn("wm", className)}>
      fac<b>t</b>rove
    </a>
  );
}
