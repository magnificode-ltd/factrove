"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FactroveApiError } from "@factrove/api-client";
import type { InvitationPreview } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authClient } from "@/auth/client";
import { authPageHref, forgetInvitationReturn, invitationCookieMaxAge, rememberInvitationReturn } from "@/auth/return-path";
import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type SessionUser = {
  email: string;
  emailVerified: boolean;
};

type InviteState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; preview: InvitationPreview };

function acceptPath(token: string): string {
  return `/invites/accept?token=${encodeURIComponent(token)}`;
}

function leaveInvitation(event: { preventDefault: () => void }): void {
  event.preventDefault();
  forgetInvitationReturn();
  window.location.assign("/");
}

function expiryLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} UTC`;
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function AcceptInviteRoute() {
  return <AcceptInvite token={useSearchParams().get("token")} />;
}

export function AcceptInvite({ token }: { token: string | null }) {
  const [state, setState] = useState<InviteState>({ kind: "loading" });
  const [session, setSession] = useState<SessionUser | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const trimmed = token?.trim() ?? "";
    if (trimmed.length === 0) {
      forgetInvitationReturn();
      setState({ kind: "invalid" });
      return;
    }
    void createWebClient().previewInvitation(trimmed).then(
      (preview) => {
        if (cancelled) {
          return;
        }
        const maxAge = invitationCookieMaxAge(preview.expiresAt);
        if (maxAge > 0) {
          rememberInvitationReturn(acceptPath(trimmed), maxAge);
        } else {
          forgetInvitationReturn();
        }
        setState({ kind: "ready", preview });
      },
      () => {
        if (!cancelled) {
          forgetInvitationReturn();
          setState({ kind: "invalid" });
        }
      },
    );
    void authClient.getSession().then(
      (result) => {
        if (cancelled) {
          return;
        }
        const user = result.data?.user;
        setSession(user ? { email: user.email, emailVerified: user.emailVerified } : null);
        setSessionLoaded(true);
      },
      () => {
        if (!cancelled) {
          setSession(null);
          setSessionLoaded(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === "loading" || (state.kind === "ready" && !sessionLoaded)) {
    return (
      <AuthScreen title="Invitation" lede="Checking this invitation." footer="Factrove">
        <Skeleton className="h-11 w-full" />
      </AuthScreen>
    );
  }

  if (state.kind === "invalid") {
    return (
      <AuthScreen
        title="This invitation link is not valid"
        lede="Ask the person who invited you for a new link."
        footer={<a className="font-semibold text-foreground underline-offset-4 hover:underline" href="/" onClick={leaveInvitation}>Go to Factrove</a>}
      >
        <Button asChild className="h-11">
          <a href="/" onClick={leaveInvitation}>Go to Factrove</a>
        </Button>
      </AuthScreen>
    );
  }

  const preview = state.preview;
  const next = acceptPath(token ?? "");
  const inviter = preview.inviter.name.trim();
  const title = `Join ${preview.organization.name}`;
  const lede = inviter.length > 0
    ? `${inviter} invited ${preview.email}. This link expires ${expiryLabel(preview.expiresAt)}.`
    : `You are invited as ${preview.email}. This link expires ${expiryLabel(preview.expiresAt)}.`;
  const signupHref = `${authPageHref("signup", next)}&email=${encodeURIComponent(preview.email)}`;
  const loginHref = authPageHref("login", next);

  async function join() {
    if (!token) {
      return;
    }
    setPending(true);
    setNote(null);
    try {
      await createWebClient().acceptInvitation(token);
      forgetInvitationReturn();
      window.location.assign("/");
    } catch (caught) {
      setPending(false);
      if (!(caught instanceof FactroveApiError)) {
        setNote("The invitation could not be accepted.");
        return;
      }
      if (caught.status === 401) {
        window.location.assign(loginHref);
        return;
      }
      if (caught.status === 404 || caught.status === 409) {
        forgetInvitationReturn();
      }
      setNote(caught.message);
    }
  }

  async function useAnotherAccount() {
    await authClient.signOut();
    window.location.assign(loginHref);
  }

  let action = (
    <div className="grid gap-3">
      <Button asChild className="h-11">
        <a href={loginHref}>Sign in</a>
      </Button>
      <Button asChild variant="outline" className="h-11 bg-white">
        <a href={signupHref}>Create an account</a>
      </Button>
      <p className="text-sm text-muted-foreground">Use {preview.email}. Either path returns here.</p>
    </div>
  );

  if (session) {
    if (!sameEmail(session.email, preview.email)) {
      action = (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            You are signed in as {session.email}. Sign in with {preview.email} to join.
          </p>
          <Button className="h-11" type="button" onClick={() => void useAnotherAccount()}>
            Use another account
          </Button>
        </div>
      );
    } else if (!session.emailVerified) {
      action = (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Confirm {preview.email} before joining. This invitation stays open.</p>
          <Button className="h-11" type="button" disabled={pending} onClick={() => void join()}>
            Join organization
          </Button>
        </div>
      );
    } else {
      action = (
        <Button className="h-11" type="button" disabled={pending} onClick={() => void join()}>
          Join organization
        </Button>
      );
    }
  }

  return (
    <AuthScreen
      title={title}
      lede={lede}
      footer={
        session ? (
          <button type="button" className="font-semibold text-foreground underline-offset-4 hover:underline" onClick={() => void useAnotherAccount()}>
            Use another account
          </button>
        ) : (
          <>
            Already have an account?{" "}
            <a className="font-semibold text-foreground underline-offset-4 hover:underline" href={loginHref}>
              Sign in
            </a>
          </>
        )
      }
    >
      {action}
      {note ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {note}
        </p>
      ) : null}
    </AuthScreen>
  );
}
