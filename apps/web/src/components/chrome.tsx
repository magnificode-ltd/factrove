import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { DocsLink } from "@/components/docs-link";
import { SourceCodeLink } from "@/components/source-code-link";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";
import type { LibraryView } from "@/library/load-library";

export const headerLinkClass =
  "inline-flex h-8 shrink-0 items-center rounded-md px-2 text-sm font-medium text-muted-foreground no-underline hover:bg-lilac hover:text-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

const separatedBarClass =
  "border-b border-border bg-white shadow-[0_1px_2px_0_color-mix(in_srgb,var(--ink)_6%,transparent)]";

export function AppBar({
  children,
  end,
  clear = false
}: {
  children?: ReactNode;
  end?: ReactNode;
  clear?: boolean;
}) {
  return (
    <header className={cn("sticky top-0 z-30", clear ? "bg-[color-mix(in_srgb,var(--cloud)_62%,transparent)] backdrop-blur-md" : separatedBarClass)}>
      <div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2 sm:px-8">
        <Wordmark />
        {children}
        {end ?? <HeaderLinks className={children ? undefined : "ml-auto"} />}
      </div>
    </header>
  );
}

const libraryBackClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink no-underline hover:bg-lilac focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

export function ViewerBar({
  title,
  meta,
  tools,
  showLibraryLink = true,
  reserveLibraryLink = false,
  showAppLinks = true
}: {
  title: string;
  meta?: ReactNode;
  tools?: ReactNode;
  showLibraryLink?: boolean;
  reserveLibraryLink?: boolean;
  showAppLinks?: boolean;
}) {
  const iconLeading = showLibraryLink || reserveLibraryLink;
  return (
    <header className={cn("sticky top-0 z-30", separatedBarClass)}>
      <div
        className={cn(
          "mx-auto grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2 sm:gap-x-3 sm:px-8",
          meta ? "gap-y-1" : ""
        )}
      >
        <div className="col-start-1 row-start-1 self-center">
          {showLibraryLink ? (
            <LibraryBack />
          ) : reserveLibraryLink ? (
            <LibraryBack reserved />
          ) : (
            <Wordmark />
          )}
        </div>
        <h1 className="col-start-2 row-start-1 min-w-0 truncate text-base leading-5 font-semibold tracking-tight text-ink" title={title}>
          {title}
        </h1>
        <div className="col-start-3 row-start-1 flex items-center justify-end gap-1.5 self-center">
          {tools}
          {showAppLinks ? <HeaderLinks /> : null}
        </div>
        {meta ? (
          <div
            className={cn(
              "col-span-3 col-start-1 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:pl-0",
              iconLeading ? "pl-10" : "pl-0"
            )}
          >
            {meta}
          </div>
        ) : null}
      </div>
    </header>
  );
}

function LibraryBack({ reserved = false }: { reserved?: boolean }) {
  if (reserved) {
    return (
      <span className={cn(libraryBackClass, "invisible")} aria-hidden="true" tabIndex={-1} aria-label="Back to library">
        <ArrowLeft aria-hidden="true" className="size-4" />
      </span>
    );
  }
  return (
    <a href="/" className={libraryBackClass} title="Back to library">
      <ArrowLeft aria-hidden="true" className="size-4" />
      <span className="sr-only">Back to library</span>
    </a>
  );
}

function HeaderLinks({ className }: { className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <DocsLink className={headerLinkClass} />
      <SourceCodeLink className={headerLinkClass} />
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
    <nav className="inline-flex items-center gap-0.5 rounded-lg bg-lilac p-0.5" aria-label="Artifact lists">
      <TabLink href="/" tab="mine" current={view === "mine"} label="My artifacts" />
      <TabLink href="/?view=org" tab="org" current={view === "org"} label="Organization artifacts" />
    </nav>
  );
}

function TabLink({
  href,
  tab,
  current,
  label
}: {
  href: string;
  tab: "mine" | "org";
  current: boolean;
  label: string;
}) {
  return (
    <a href={href} aria-current={current ? "page" : undefined} className={tabClass(current)}>
      {current ? <span aria-hidden="true" data-tab={tab} className="ft-tab-pill" /> : null}
      <span className="relative">{label}</span>
    </a>
  );
}

function tabClass(current: boolean) {
  return cn(
    "relative inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap no-underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d",
    current
      ? "text-ink"
      : "text-muted-foreground hover:bg-[color-mix(in_srgb,white_72%,transparent)] hover:text-ink"
  );
}
