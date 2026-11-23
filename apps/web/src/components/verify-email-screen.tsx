"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthScreen } from "@/components/auth-screen";
import { AppBar } from "@/components/chrome";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import { invitationReturnPath, readInvitationReturn, rememberInvitationReturn } from "@/auth/return-path";

const textLinkClass =
  "font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

type Status = "pending" | "success" | "expired" | "error";

export function VerifyEmailRoute() {
  const params = useSearchParams();
  const fromQuery = invitationReturnPath(params.get("next"));
  const [returnTo, setReturnTo] = useState<string | null>(fromQuery);

  useEffect(() => {
    const path = fromQuery ?? readInvitationReturn();
    setReturnTo(path);
    rememberInvitationReturn(path);
  }, [fromQuery]);

  return <VerifyEmailScreen token={params.get("token")} returnTo={returnTo} />;
}

export function VerifyEmailScreen({ token, returnTo = null }: { token: string | null; returnTo?: string | null }) {
  const [status, setStatus] = useState<Status>(token ? "pending" : "expired");
  const backHref = returnTo ?? "/";
  const backLabel = returnTo ? "Back to the invitation" : "Back to the library";

  useEffect(() => {
    if (!token) {
      setStatus("expired");
      return;
    }
    let cancelled = false;
    void authClient.verifyEmail({ query: { token } }).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.error) {
        setStatus(isExpired(result.error) ? "expired" : "error");
        return;
      }
      window.dispatchEvent(new Event("factrove-email-verified"));
      setStatus("success");
    }).catch(() => {
      if (!cancelled) {
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "success") {
    return (
      <div className="ft-canvas min-h-dvh">
        <AppBar />
        <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-5 px-5 py-16 sm:px-8">
          <h1 className="ft-title text-4xl text-balance">Email confirmed</h1>
          <p role="status" data-testid="verify-email-success" className="text-lg leading-relaxed text-muted-foreground">
            {returnTo
              ? "This address is verified. Continue to join the organization."
              : "This address is verified. You can keep using Factrove."}
          </p>
          <Button asChild className="h-11">
            <a href={backHref}>{returnTo ? "Continue" : "Back to the library"}</a>
          </Button>
        </main>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <AuthScreen
        title="This confirmation link is not valid"
        lede="It may have expired or already been used. Request another from Factrove."
        footer={<a className={textLinkClass} href={backHref}>{backLabel}</a>}
      >
        <p role="status" data-testid="verify-email-expired" className="text-sm leading-relaxed text-muted-foreground">
          Confirmation links last one hour. If you are signed in, use Resend on the verify notice.
        </p>
      </AuthScreen>
    );
  }

  if (status === "error") {
    return (
      <AuthScreen
        title="Could not confirm the email"
        lede="The link did not go through. Try it again."
        footer={<a className={textLinkClass} href={backHref}>{backLabel}</a>}
      >
        <p role="alert" className="text-sm font-medium text-destructive">
          Could not confirm the email. Try the link again.
        </p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Confirming your email"
      lede="This takes a moment."
      footer={<a className={textLinkClass} href={backHref}>{backLabel}</a>}
    >
      <p role="status" className="text-sm leading-relaxed text-muted-foreground">
        Confirming your email…
      </p>
      <Button type="button" className="h-11" disabled>
        Confirming…
      </Button>
    </AuthScreen>
  );
}

function isExpired(error: { message?: string; code?: string }): boolean {
  if (error.code === "INVALID_TOKEN" || error.code === "TOKEN_EXPIRED") {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return message === "invalid token" || message === "token expired";
}
