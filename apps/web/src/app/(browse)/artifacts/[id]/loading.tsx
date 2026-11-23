import { ViewerBar } from "@/components/chrome";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewerMenu } from "@/viewer/viewer-menu";

export default function LoadingArtifact() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ViewerBar title="Artifact" showLibraryLink={false} reserveLibraryLink showAppLinks={false} tools={<ViewerMenu />} />
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 bg-white px-6">
        <div className="grid w-full max-w-3xl gap-3" aria-hidden="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-80 w-full rounded-2xl" />
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          Loading artifact…
        </p>
      </main>
    </div>
  );
}
