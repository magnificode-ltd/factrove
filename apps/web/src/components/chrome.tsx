import type { ReactNode } from "react";

export function PageIntro({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="masthead">
      <div className="title-block">
        <p className="product">Factrove</p>
        <h1>{title}</h1>
      </div>
      {actions}
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
