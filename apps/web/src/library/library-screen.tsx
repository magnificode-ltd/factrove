import type { ContextEnvelope } from "@factrove/contracts";
import { ArrowUpRight } from "lucide-react";
import { AppBar, ModeNote, TabLink } from "@/components/chrome";
import { SignOutButton } from "@/components/sign-out-button";
import { UploadSketch } from "@/components/upload-sketch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accessLabel, formatBytes, formatUploadedAt } from "@/format";
import type { LibraryModel } from "@/library/load-library";

function contextLabel(context: ContextEnvelope): string {
  return `${context.user.name} · ${context.organization?.name ?? "No organization"}`;
}

function refreshHref(state: LibraryModel): string {
  return state.view === "org" ? "/?view=org" : "/";
}

export function LibraryScreen({ state }: { state: LibraryModel }) {
  const title = state.view === "mine" ? "My artifacts" : "Organization artifacts";
  const signedIn = state.status === "ready" || state.status === "empty" || state.status === "no-organization";
  return (
    <div className="ft-canvas min-h-dvh">
      <AppBar>
        <nav className="flex flex-wrap items-center gap-1 rounded-full bg-secondary p-1" aria-label="Artifact lists">
          <TabLink href="/" current={state.view === "mine"}>
            My artifacts
          </TabLink>
          <TabLink href="/?view=org" current={state.view === "org"}>
            Organization artifacts
          </TabLink>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="h-10">
            <a href={refreshHref(state)}>Refresh</a>
          </Button>
          {state.status === "signed-out" ? (
            <>
              <Button asChild className="h-10">
                <a href="/login">Sign in</a>
              </Button>
              <Button asChild variant="outline" className="h-10">
                <a href="/signup">Create account</a>
              </Button>
            </>
          ) : null}
          {signedIn ? (
            <>
              <Button asChild variant="outline" className="h-10">
                <a href="/account/api-keys">API keys</a>
              </Button>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </AppBar>
      <main className="ft-enter mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-semibold tracking-[0.14em] text-[#5c63c9] uppercase">Library</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        {signedIn ? <ModeNote /> : null}
        {signedIn ? <p className="mt-4 text-sm font-medium text-muted-foreground">{contextLabel(state.context)}</p> : null}
        <LibraryBody state={state} />
      </main>
    </div>
  );
}

function LibraryBody({ state }: { state: LibraryModel }) {
  if (state.status === "signed-out") {
    return (
      <Card role="status" className="mt-10 max-w-xl bg-white">
        <CardContent className="flex flex-col items-start gap-4">
          <UploadSketch />
          <p className="text-lg leading-relaxed">Sign in to see your artifacts.</p>
        </CardContent>
      </Card>
    );
  }
  if (state.status === "unavailable") {
    return (
      <Alert variant="destructive" className="mt-10 max-w-2xl bg-white">
        <AlertDescription className="text-base text-destructive">{state.message}</AlertDescription>
      </Alert>
    );
  }
  if (state.status === "no-organization") {
    return (
      <Card role="status" className="mt-10 max-w-xl bg-white">
        <CardContent>
          <p className="text-lg leading-relaxed">
            {state.context.user.name} has no configured organization. Organization artifacts stay empty until one is set.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (state.status === "empty") {
    const message =
      state.view === "mine"
        ? "No artifacts yet. Upload an HTML file with the Factrove CLI, then refresh."
        : `No organization-shared artifacts for ${state.context.organization?.name ?? "this organization"}.`;
    return (
      <Card role="status" className="mt-10 max-w-xl bg-white">
        <CardContent className="flex flex-col items-start gap-4">
          <UploadSketch />
          <p className="text-lg leading-relaxed">{message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="ft-list mt-10 grid list-none gap-3 p-0">
      {state.items.map((artifact) => (
        <li key={artifact.id}>
          <a
            className="ft-motion group grid grid-cols-1 items-center gap-3 rounded-2xl border border-border bg-white px-5 py-4 text-foreground no-underline shadow-sm motion-safe:transition-[transform,box-shadow,border-color] motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-[#858BEE] motion-safe:hover:shadow-[0_18px_40px_-28px_rgba(133,139,238,0.95)] motion-safe:active:translate-y-0 motion-safe:active:scale-[0.995] sm:grid-cols-[minmax(0,1fr)_auto]"
            href={`/artifacts/${encodeURIComponent(artifact.id)}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="truncate text-base font-semibold">{artifact.filename}</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" />
            </span>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground sm:justify-end">
              <Badge variant={artifact.accessType === "private" ? "secondary" : "default"} className="h-6">
                {accessLabel(artifact.accessType)}
              </Badge>
              <time dateTime={artifact.uploadedAt}>{formatUploadedAt(artifact.uploadedAt)}</time>
              <span>{formatBytes(artifact.sizeBytes)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
