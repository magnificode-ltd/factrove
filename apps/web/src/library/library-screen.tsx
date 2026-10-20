import type { ContextEnvelope } from "@factrove/contracts";
import { ArtifactCard } from "@/components/artifact-card";
import { CliTerminal, uploadCommand } from "@/components/cli-terminal";
import { AppBar, LibraryTabs, ModeNote } from "@/components/chrome";
import { CopyButton } from "@/components/copy-button";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LibraryModel } from "@/library/load-library";

function contextLabel(context: ContextEnvelope): string {
  return `${context.user.name} · ${context.organization?.name ?? "No organization"}`;
}

function refreshHref(state: LibraryModel): string {
  return state.view === "org" ? "/?view=org" : "/";
}

export function LibraryScreen({ state }: { state: LibraryModel }) {
  const title = state.view === "mine" ? "My artifacts" : "Organization artifacts";
  const now = Date.now();
  const signedIn = state.status === "ready" || state.status === "empty" || state.status === "no-organization";
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero">
        <AppBar clear>
          <LibraryTabs view={state.view} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" className="h-10 bg-white">
              <a href={refreshHref(state)}>Refresh</a>
            </Button>
            {state.status === "signed-out" ? (
              <>
                <Button asChild className="h-10">
                  <a href="/login">Sign in</a>
                </Button>
                <Button asChild variant="outline" className="h-10 bg-white">
                  <a href="/signup">Create account</a>
                </Button>
              </>
            ) : null}
            {signedIn ? (
              <>
                <Button asChild variant="outline" className="h-10 bg-white">
                  <a href="/account/api-keys">API keys</a>
                </Button>
                <SignOutButton />
              </>
            ) : null}
          </div>
        </AppBar>
        <main className="ft-enter mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-sm font-semibold tracking-[0.16em] text-peri-d uppercase">Library</p>
          <h1 className="ft-title mt-2 text-4xl sm:text-5xl">{title}</h1>
          {signedIn ? <ModeNote /> : null}
          {signedIn ? <p className="mt-4 text-sm font-medium text-muted-foreground">{contextLabel(state.context)}</p> : null}
          <LibraryBody state={state} now={now} />
        </main>
      </div>
    </div>
  );
}

function LibraryBody({ state, now }: { state: LibraryModel; now: number }) {
  if (state.status === "signed-out") {
    return (
      <Card role="status" className="mt-10 max-w-xl bg-white">
        <CardContent className="flex flex-col items-start gap-4">
          <CliTerminal />
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
          {state.view === "mine" ? <CliTerminal /> : null}
          <p className="text-lg leading-relaxed">{message}</p>
          {state.view === "mine" ? (
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-lilac px-3 py-2 font-mono text-sm text-ink">{uploadCommand}</code>
              <CopyButton label="Copy command" copiedLabel="Copied" message="Command copied" value={uploadCommand} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="ft-list mt-10 grid list-none gap-3 p-0">
      {state.items.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} now={now} />
      ))}
    </ul>
  );
}
