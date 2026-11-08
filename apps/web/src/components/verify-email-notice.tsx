"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";

const DISMISS_PREFIX = "factrove.verify-dismissed.";

type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

export function VerifyEmailNotice() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let verified = false;
    void authClient.getSession().then((result) => {
      if (cancelled || verified) {
        return;
      }
      const next = result.data?.user;
      if (!next || next.emailVerified) {
        setUser(null);
        return;
      }
      setUser(next);
      setDismissed(window.sessionStorage.getItem(DISMISS_PREFIX + next.id) === "1");
    }).catch(() => {
      if (!cancelled) {
        setUser(null);
      }
    });
    function onVerified() {
      verified = true;
      setUser(null);
    }
    window.addEventListener("factrove-email-verified", onVerified);
    return () => {
      cancelled = true;
      window.removeEventListener("factrove-email-verified", onVerified);
    };
  }, []);

  if (!user || dismissed) {
    return null;
  }

  async function resend() {
    if (!user) {
      return;
    }
    setPending(true);
    setNote(null);
    try {
      const result = await authClient.sendVerificationEmail({ email: user.email });
      setPending(false);
      if (result.error) {
        setNote(result.error.status === 429
          ? "Too many emails. Please try again in a minute."
          : "Could not send the email. Try again.");
        return;
      }
      setNote("Sent. The link expires in one hour.");
    } catch {
      setPending(false);
      setNote("Could not send the email. Try again.");
    }
  }

  function dismiss() {
    if (!user) {
      return;
    }
    window.sessionStorage.setItem(DISMISS_PREFIX + user.id, "1");
    setDismissed(true);
  }

  return (
    <div role="region" aria-label="Email verification" className="border-b border-border bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">
          <span className="font-semibold">Verify your email.</span> You can keep using Factrove either way.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" className="h-9" onClick={() => void resend()} disabled={pending}>
            {pending ? "Sending…" : "Resend"}
          </Button>
          <Button type="button" variant="ghost" className="h-9 w-9" aria-label="Dismiss email reminder" onClick={dismiss}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {note ? (
          <p role="status" className="w-full text-sm text-muted-foreground">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
