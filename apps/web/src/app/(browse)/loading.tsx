import { AppBar, LibraryTabs, ModeNote } from "@/components/chrome";
import { RefreshLink } from "@/components/refresh-link";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero">
        <AppBar
          end={
            <div className="ml-auto flex items-center">
              <RefreshLink href="/" />
            </div>
          }
        >
          <div className="order-last w-full sm:order-none sm:w-auto">
            <LibraryTabs view="none" />
          </div>
        </AppBar>
        <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-sm font-semibold tracking-[0.16em] text-peri-d uppercase">Library</p>
          <h1 className="ft-title mt-2 text-4xl sm:text-5xl">Artifacts</h1>
          <ModeNote />
          <p role="status" className="mt-6 text-sm text-muted-foreground">
            Loading artifacts…
          </p>
          <div className="mt-6 grid gap-3" aria-hidden="true">
            <Skeleton className="h-20 w-full rounded-[14px]" />
            <Skeleton className="h-20 w-full rounded-[14px]" />
            <Skeleton className="h-20 w-full rounded-[14px]" />
          </div>
        </main>
      </div>
    </div>
  );
}
