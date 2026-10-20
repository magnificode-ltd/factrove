import { AppBar } from "@/components/chrome";
import { FactroveLogo } from "@/components/factrove-logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="ft-canvas min-h-dvh">
      <AppBar />
      <main className="ft-enter mx-auto flex w-full max-w-3xl flex-col items-start gap-5 px-5 py-16 sm:px-8 sm:py-24">
        <FactroveLogo className="size-16" />
        <p className="text-sm font-semibold tracking-[0.16em] text-[#5c63c9] uppercase">404</p>
        <h1 className="font-display text-5xl font-semibold tracking-tight">Page not found</h1>
        <p role="alert" className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          That link does not lead to an artifact or a page in Factrove.
        </p>
        <Button asChild className="h-11">
          <a href="/">Back to library</a>
        </Button>
      </main>
    </div>
  );
}
