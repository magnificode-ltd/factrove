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
      Local unauthenticated mode. Private and organization-shared labels only decide which list an artifact appears in.
      They are not access control.
    </p>
  );
}
