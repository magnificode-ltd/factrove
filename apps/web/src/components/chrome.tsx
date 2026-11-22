import type { ReactNode } from "react";
import { DocsLink } from "@/components/docs-link";
import { SourceCodeLink } from "@/components/source-code-link";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LibraryView } from "@/library/load-library";

const sourceLinkClass =
  "shrink-0 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

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
        <HeaderLinks className={children ? undefined : "ml-auto"} />
      </div>
    </header>
  );
}

export function ViewerBar({
  title,
  meta,
  tools,
  showLibraryLink = true,
  reserveLibraryLink = false
}: {
  title: string;
  meta?: ReactNode;
  tools?: ReactNode;
  showLibraryLink?: boolean;
  reserveLibraryLink?: boolean;
}) {
  return (
    <header className="z-30 border-b border-border bg-cloud">
      <div className="mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Wordmark />
        {showLibraryLink ? (
          <Button asChild variant="outline" className="h-10">
            <a href="/">Back to library</a>
          </Button>
        ) : reserveLibraryLink ? (
          <Button asChild variant="outline" className="invisible h-10" aria-hidden="true" tabIndex={-1}>
            <span>Back to library</span>
          </Button>
        ) : null}
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-tight" title={title}>
          {title}
        </h1>
        {meta}
        {tools}
        <HeaderLinks />
      </div>
    </header>
  );
}

function HeaderLinks({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-4", className)}>
      <DocsLink className={sourceLinkClass} />
      <SourceCodeLink className={sourceLinkClass} />
    </div>
  );
}

export function ModeNote() {
  return (
    <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
      Private artifacts are visible only to you. Organization-shared artifacts are visible to members of that
      organization. A public link works only after you share the artifact.
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
    "relative z-10 rounded-full px-4 py-2 text-center text-sm font-semibold no-underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d",
    current ? "text-ink" : "text-muted-foreground hover:text-ink"
  );
}
