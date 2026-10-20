import type { ContextEnvelope } from "@factrove/contracts";
import { AppBar, ModeNote } from "@/components/chrome";
import { SignOutButton } from "@/components/sign-out-button";
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
    <div className="library-page">
      <AppBar>
        <nav className="tabs" aria-label="Artifact lists">
          <a href="/" aria-current={state.view === "mine" ? "page" : undefined}>
            My artifacts
          </a>
          <a href="/?view=org" aria-current={state.view === "org" ? "page" : undefined}>
            Organization artifacts
          </a>
        </nav>
        <a className="refresh" href={refreshHref(state)}>
          Refresh
        </a>
        {state.status === "signed-out" ? (
          <>
            <a className="refresh" href="/login">
              Sign in
            </a>
            <a className="refresh" href="/signup">
              Create account
            </a>
          </>
        ) : null}
        {signedIn ? (
          <>
            <a className="refresh" href="/account/api-keys">
              API keys
            </a>
            <SignOutButton />
          </>
        ) : null}
      </AppBar>
      <main className="catalog">
        <h1 className="page-title">{title}</h1>
        {signedIn ? <ModeNote /> : null}
        {signedIn ? <p className="context">{contextLabel(state.context)}</p> : null}
        <LibraryBody state={state} />
      </main>
    </div>
  );
}

function LibraryBody({ state }: { state: LibraryModel }) {
  if (state.status === "signed-out") {
    return (
      <p role="status" className="banner">
        Sign in to see your artifacts.
      </p>
    );
  }
  if (state.status === "unavailable") {
    return (
      <p role="alert" className="banner error">
        {state.message}
      </p>
    );
  }
  if (state.status === "no-organization") {
    return (
      <p role="status" className="banner">
        {state.context.user.name} has no configured organization. Organization artifacts stay empty until one is set.
      </p>
    );
  }
  if (state.status === "empty") {
    const message =
      state.view === "mine"
        ? "No artifacts yet. Upload an HTML file with the Factrove CLI, then refresh."
        : `No organization-shared artifacts for ${state.context.organization?.name ?? "this organization"}.`;
    return (
      <p role="status" className="banner">
        {message}
      </p>
    );
  }

  return (
    <ul className="list">
      {state.items.map((artifact) => (
        <li key={artifact.id}>
          <a className="row" href={`/artifacts/${encodeURIComponent(artifact.id)}`}>
            <span className="filename">{artifact.filename}</span>
            <span className="row-meta">
              <span>{accessLabel(artifact.accessType)}</span>
              <time dateTime={artifact.uploadedAt}>{formatUploadedAt(artifact.uploadedAt)}</time>
              <span>{formatBytes(artifact.sizeBytes)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
