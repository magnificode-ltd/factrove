"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AuthField } from "@/components/auth-field";
import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import { authPageHref, safeNextPath } from "@/auth/return-path";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const next = safeNextPath(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Could not sign in.");
      return;
    }
    window.location.assign(next);
  }

  return (
    <AuthScreen
      title="Sign in"
      lede="Sign in to your Factrove library."
      footer={
        <>
          New here?{" "}
          <a className="font-semibold text-foreground underline-offset-4 hover:underline" href={authPageHref("signup", next)}>
            Create an account
          </a>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <AuthField id="email" name="email" label="Email" type="email" autoComplete="email" required />
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <p className="text-right text-sm">
          <a
            className="font-semibold text-peri-d underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-peri-d"
            href={authPageHref("forgot-password", next)}
          >
            Forgot password?
          </a>
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button className="h-11" type="submit" disabled={pending}>
          Sign in
        </Button>
      </form>
    </AuthScreen>
  );
}
