import type { ReactNode } from "react";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import type { LibraryView } from "@/library/load-library";

export function AppBar({ children, clear = false }: { children?: ReactNode; clear?: boolean }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30",
        clear
          ? "bg-[color-mix(in_srgb,var(--cloud)_62%,transparent)] backdrop-blur-md"
          : "border-b border-border bg-[color-mix(in_srgb,var(--cloud)_88%,transparent)] backdrop-blur-md"
      )}
    >
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8">
        <Wordmark />
        {children}
      </div>
    </header>
  );
}

export function ViewerBar({ title, meta, tools }: { title: string; meta?: ReactNode; tools?: ReactNode }) {
  return (
    <header className="z-30 border-b border-border bg-cloud">
      <div className="mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Wordmark />
        <Button asChild variant="outline" className="h-10">
          <a href="/">Back to library</a>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight" title={title}>
          {title}
        </h1>
        {meta}
        {tools}
      </div>
    </header>
  );
}

export function ModeNote() {
  return (
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
      Private artifacts are visible only to you. Organization-shared artifacts are visible to members of that organization.
    </p>
  );
}

export function LibraryTabs({ view }: { view: LibraryView | "none" }) {
  return (
    <nav className="relative inline-grid grid-cols-2 rounded-full bg-lilac p-1" aria-label="Artifact lists">
      {view === "none" ? null : <span aria-hidden="true" data-tab={view} className="ft-tab-pill" />}
      <a href="/" aria-current={view === "mine" ? "page" : undefined} className={tabClass(view === "mine")}>
        My artifacts
      </a>
      <a
        href="/?view=org"
        aria-current={view === "org" ? "page" : undefined}
        className={tabClass(view === "org")}
      >
        Organization artifacts
      </a>
    </nav>
  );
}

function tabClass(current: boolean) {
  return cn(
    "relative z-10 rounded-full px-4 py-2 text-center text-sm font-semibold no-underline",
    current ? "text-ink" : "text-muted-foreground hover:text-ink"
  );
}
