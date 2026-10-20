import { AppBar, ModeNote, TabLink } from "@/components/chrome";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="ft-canvas min-h-dvh">
      <AppBar>
        <nav className="flex flex-wrap items-center gap-1 rounded-full bg-secondary p-1" aria-label="Artifact lists">
          <TabLink href="/" current={false}>
            My artifacts
          </TabLink>
          <TabLink href="/?view=org" current={false}>
            Organization artifacts
          </TabLink>
        </nav>
        <div className="ml-auto">
          <Button asChild variant="outline" className="h-10">
            <a href="/">Refresh</a>
          </Button>
        </div>
      </AppBar>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-semibold tracking-[0.14em] text-[#5c63c9] uppercase">Library</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">Artifacts</h1>
        <ModeNote />
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Loading artifacts…
        </p>
        <div className="mt-6 grid gap-3" aria-hidden="true">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
