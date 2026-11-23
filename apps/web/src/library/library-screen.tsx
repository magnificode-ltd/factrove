import type { ContextEnvelope } from "@factrove/contracts";
import { AccountMenu } from "@/components/account-menu";
import { ArtifactCard } from "@/components/artifact-card";
import { CliTerminal } from "@/components/cli-terminal";
import { AppBar, headerLinkClass, LibraryTabs, ModeNote } from "@/components/chrome";
import { DocsLink } from "@/components/docs-link";
import { RefreshLink } from "@/components/refresh-link";
import { SourceCodeLink } from "@/components/source-code-link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { gettingStartedCopy } from "@/library/getting-started";
import { GettingStarted, OrganizationEmpty } from "@/library/getting-started-card";
import type { LibraryModel } from "@/library/load-library";
import { cliApiOrigin } from "@/public-config";

function contextLabel(context: ContextEnvelope): string {
  return `${context.user.name} · ${context.organization?.name ?? "No organization"}`;
}

function accountContext(state: LibraryModel): ContextEnvelope | null {
  if (state.status === "ready" || state.status === "empty" || state.status === "no-organization") {
    return state.context;
  }
  return null;
}

function refreshHref(state: LibraryModel): string {
  return state.view === "org" ? "/?view=org" : "/";
}

const textControlClass =
  "inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium no-underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

export function LibraryScreen({ state }: { state: LibraryModel }) {
  const title = state.view === "mine" ? "My artifacts" : "Organization artifacts";
  const now = Date.now();
  const account = accountContext(state);
  return (
    <div className="ft-canvas min-h-dvh">
      <div className="ft-hero">
        <AppBar
          end={
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-0.5 sm:gap-1">
              <DocsLink className={headerLinkClass} />
              <SourceCodeLink className={headerLinkClass} />
              <RefreshLink href={refreshHref(state)} />
              {account ? (
                <a href="/account/members" className={cn(headerLinkClass, "hidden sm:inline-flex")}>
                  Members
                </a>
              ) : null}
              {account ? (
                <a href="/account/api-keys" className={cn(headerLinkClass, "hidden sm:inline-flex")}>
                  API keys
                </a>
              ) : null}
              {state.status === "signed-out" ? (
                <>
                  <a href="/login" className={cn(textControlClass, "bg-primary text-primary-foreground hover:bg-peri-press")}>
                    Sign in
                  </a>
                  <a href="/signup" className={cn(textControlClass, "border border-border bg-white text-ink hover:bg-lilac")}>
                    Create account
                  </a>
                </>
              ) : null}
              {account ? (
                <AccountMenu name={account.user.name} organization={account.organization?.name ?? null} />
              ) : null}
            </div>
          }
        >
          <div className="order-last w-full sm:order-none sm:w-auto">
            <LibraryTabs view={state.view} />
          </div>
        </AppBar>
        <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-sm font-semibold tracking-[0.16em] text-peri-d uppercase">Library</p>
          <h1 className="ft-title mt-2 text-4xl sm:text-5xl">{title}</h1>
          {account ? <ModeNote /> : null}
          {account ? <p className="mt-4 text-sm font-medium text-muted-foreground">{contextLabel(account)}</p> : null}
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
