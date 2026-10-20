import { cn } from "cn";

export function Wordmark({ className, large = false }: { className?: string; large?: boolean }) {
  return (
    <a href="/" className={cn("wm", large ? "wm-lg" : "wm-mark", className)}>
      fac<b>t</b>rove
    </a>
  );
}
