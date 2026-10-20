import type { ReactNode } from "react";
import { FactroveLogo } from "@/components/factrove-logo";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-[#F5F6FC]/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8">
        <BrandLink />
        {children}
      </div>
    </header>
  );
}

export function ViewerBar({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <header className="z-30 border-b border-border bg-[#F5F6FC]">
      <div className="mx-auto flex min-h-16 w-full max-w-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <BrandLink />
        <Button asChild variant="outline" className="h-10">
          <a href="/">Back to library</a>
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-tight" title={title}>
          {title}
        </h1>
        {meta}
      </div>
    </header>
  );
}

export function BrandLink() {
  return (
    <a href="/" className="inline-flex items-center gap-2.5 rounded-xl text-foreground no-underline">
      <FactroveLogo />
      <span className="font-display text-[1.65rem] leading-none font-semibold tracking-tight">Factrove</span>
    </a>
  );
}

export function ModeNote() {
  return (
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
      Private artifacts are visible only to you. Organization-shared artifacts are visible to members of that organization.
    </p>
  );
}

export function TabLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-semibold no-underline motion-safe:transition-colors",
        current
          ? "bg-white text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-white/80 hover:text-foreground"
      )}
    >
      {children}
    </a>
  );
}
