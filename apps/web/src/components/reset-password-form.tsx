"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthScreen } from "@/components/auth-screen";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { authClient } from "@/auth/client";
import { ACCOUNT_PASSWORD_HINT, accountPasswordError } from "@/auth/password-rules";
import { authPageHref } from "@/auth/return-path";

const textLinkClass =
  "font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d";

export function ResetPasswordForm({ token, next }: { token: string | null; next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(token === null || token.length === 0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (done || expired) {
      statusRef.current?.focus();
    }
  }, [done, expired]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token === null || token.length === 0) {
      setExpired(true);
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const rule = accountPasswordError(password);
    if (rule) {
      setError(rule);
      return;
    }
    if (password !== confirm) {
      setError("Enter the same password again.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      setPending(false);
      if (result.error) {
        if (isInvalidToken(result.error)) {
          setExpired(true);
          return;
        }
        setError(result.error.status === 429
          ? "Too many attempts. Please try again in a minute."
          : result.error.message ?? "Could not update the password.");
        return;
      }
      setDone(true);
    } catch {
      setPending(false);
      setError("Could not update the password. Try again.");
    }
  }

  if (expired) {
    return (
      <AuthScreen
        title="This reset link is not valid"
        lede="It may have expired or already been used. Request a new one."
        footer={
          <a className={textLinkClass} href={authPageHref("login", next)}>
            Back to sign in
          </a>
        }
      >
        <div className="grid gap-4">
          <p
            ref={statusRef}
            tabIndex={-1}
            role="status"
            data-testid="reset-password-expired"
            className="text-sm leading-relaxed text-muted-foreground outline-none"
          >
            Reset links last one hour and work once. Ask for another link to choose a new password.
          </p>
          <Button asChild className="h-11">
            <a href={authPageHref("forgot-password", next)}>Request a new link</a>
          </Button>
        </div>
      </AuthScreen>
    );
  }

  if (done) {
    return (
      <AuthScreen
        title="Password updated"
        lede="Sign in with the new password."
        footer={
          <a className={textLinkClass} href={authPageHref("forgot-password", next)}>
            Forgot password?
          </a>
        }
      >
        <div className="grid gap-4">
          <p
            ref={statusRef}
            tabIndex={-1}
            role="status"
            data-testid="reset-password-success"
            className="text-sm leading-relaxed text-muted-foreground outline-none"
          >
            The reset link is used up. The next sign-in needs the password you just chose.
          </p>
          <Button asChild className="h-11">
            <a href={authPageHref("login", next)}>Sign in</a>
          </Button>
        </div>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Choose a new password"
      lede="Use 8 to 128 characters, and skip passwords that show up everywhere."
      footer={
        <a className={textLinkClass} href={authPageHref("login", next)}>
          Back to sign in
        </a>
      }
    >
      <form className="grid gap-5" onSubmit={onSubmit} noValidate>
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "password-hint reset-password-error" : "password-hint"}
          />
          <p id="password-hint" className="text-sm leading-relaxed text-muted-foreground">
            {ACCOUNT_PASSWORD_HINT}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
        </div>
        {error ? (
          <p id="reset-password-error" role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button className="h-11" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthScreen>
  );
}

function isInvalidToken(error: { status?: number; message?: string; code?: string }): boolean {
  if (error.code === "INVALID_TOKEN" || error.code === "TOKEN_EXPIRED") {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return message === "invalid token" || message === "token expired";
}
