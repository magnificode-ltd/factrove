import type { ReactNode } from "react";

export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="app-bar">
      <a className="wordmark" href="/">
        Factrove
      </a>
      {children}
    </header>
  );
}

export function ViewerBar({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <header className="app-bar">
      <a className="wordmark" href="/">
        Factrove
      </a>
      <a className="back" href="/">
        Back to library
      </a>
      <h1 className="bar-title" title={title}>
        {title}
      </h1>
      {meta}
    </header>
  );
}

export function ModeNote() {
  return (
    <p className="mode">
      Private artifacts are visible only to you. Organization-shared artifacts are visible to members of that organization.
    </p>
  );
}
