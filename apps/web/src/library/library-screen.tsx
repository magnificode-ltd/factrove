import type { ContextEnvelope } from "@factrove/contracts";
import { ArtifactCard } from "@/components/artifact-card";
import { CliTerminal } from "@/components/cli-terminal";
import { AppBar, LibraryTabs, ModeNote } from "@/components/chrome";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { gettingStartedCopy } from "@/library/getting-started";
import { GettingStarted, OrganizationEmpty } from "@/library/getting-started-card";
import type { LibraryModel } from "@/library/load-library";
import { cliApiOrigin } from "@/public-config";

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
        <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
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
  if (state.status === "setup-required") {
    return null;
  }
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
    const copy = gettingStartedCopy({ apiOrigin: cliApiOrigin() });
    if (state.view === "mine") {
      return <GettingStarted copy={copy} />;
    }
    return (
      <OrganizationEmpty
        organizationName={state.context.organization?.name ?? "this organization"}
        copy={copy}
      />
    );
  }

  return (
    <ul className="mt-10 grid list-none gap-3 p-0">
      {state.items.map((artifact) => (
        <ArtifactCard
          key={artifact.id}
          artifact={artifact}
          now={now}
          canShare={artifact.creatorUserId === state.context.user.id}
          organization={state.context.organization}
        />
      ))}
    </ul>
  );
}
