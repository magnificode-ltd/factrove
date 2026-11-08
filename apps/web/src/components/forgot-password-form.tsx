"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthField } from "@/components/auth-field";
import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import { authPageHref } from "@/auth/return-path";

const textLinkClass =
  "font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

export function ForgotPasswordForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sent) {
      statusRef.current?.focus();
    }
  }, [sent]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email.includes("@") || email.startsWith("@") || email.endsWith("@") || /\s/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({ email });
      if (result.error && !sameConfirmation(result.error)) {
        setPending(false);
        setError(failureMessage(result.error.status));
        return;
      }
      setSent(true);
    } catch {
      setPending(false);
      setError("Could not send the reset email. Try again.");
    }
  }

  return (
    <AuthScreen
      title={sent ? "Check your email" : "Forgot password"}
      lede={
        sent
          ? "The link expires in one hour. You get this page whether or not an account uses that address."
          : "Enter the email on the account. We send a reset link when it matches."
      }
      footer={
        <a className={textLinkClass} href={authPageHref("login", next)}>
          Back to sign in
        </a>
      }
    >
      {sent ? (
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          data-testid="forgot-password-sent"
          className="text-sm leading-relaxed text-muted-foreground outline-none"
        >
          If an account exists for that address, we sent a reset link. It expires in one hour.
        </p>
      ) : (
        <form className="grid gap-5" onSubmit={onSubmit} noValidate>
          <AuthField
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "forgot-password-error" : undefined}
          />
          {error ? (
            <p id="forgot-password-error" role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button className="h-11" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Email reset link"}
          </Button>
        </form>
      )}
    </AuthScreen>
  );
}

function sameConfirmation(error: { status?: number; message?: string }): boolean {
  if (error.status === 404) {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return message.includes("user not found") || message.includes("does not exist") || message.includes("not exist");
}

function failureMessage(status: number | undefined): string {
  if (status === 429) {
    return "Too many requests. Please try again in a minute.";
  }
  return "Could not send the reset email. Try again.";
}
