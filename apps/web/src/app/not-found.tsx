import { AppBar } from "@/components/chrome";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero">
        <AppBar clear />
        <main className="ft-enter mx-auto flex w-full max-w-3xl flex-col items-start gap-5 px-5 py-16 sm:px-8 sm:py-24">
          <Wordmark large />
          <p className="font-mono text-sm font-medium tracking-[0.18em] text-peri-d uppercase">404</p>
          <h1 className="ft-title text-5xl">This page wandered off.</h1>
          <div className="ft-term w-full max-w-md" aria-hidden="true">
            <p className="px-4 py-4 font-mono text-sm">
              <span className="text-peri">$ </span>
              factrove open /this-page
              <span className="mt-2 block text-[#ffb4b4]">page not found</span>
            </p>
          </div>
          <p role="alert" className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            That link does not lead to an artifact or a page in Factrove.
          </p>
          <Button asChild className="h-11">
            <a href="/">Back to library</a>
          </Button>
        </main>
      </div>
    </div>
  );
}
