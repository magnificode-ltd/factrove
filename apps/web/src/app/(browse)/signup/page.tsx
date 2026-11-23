"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AuthField } from "@/components/auth-field";
import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/ui/button";
import { invitationEmailSchema } from "@factrove/contracts";
import { authClient } from "@/auth/client";
import { invitationReturnPath, rememberInvitationReturn, authPageHref, safeNextPath } from "@/auth/return-path";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const inviteNext = invitationReturnPath(next);
  const invited = invitationEmailSchema.safeParse(params.get("email") ?? "");
  const emailDefault = invited.success ? invited.data : "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    rememberInvitationReturn(inviteNext);
  }, [inviteNext]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name,
      email,
      password,
      ...(inviteNext ? { callbackURL: inviteNext } : {}),
    });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Could not create the account.");
      return;
    }
    window.location.assign(next);
  }

  return (
    <AuthScreen
      title="Create account"
      lede="A library for the pages you and your agents keep."
      footer={
        <>
          Already have an account?{" "}
          <a className="font-semibold text-foreground underline-offset-4 hover:underline" href={authPageHref("login", next)}>
            Sign in
          </a>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <AuthField id="name" name="name" label="Name" autoComplete="name" required />
        <AuthField
          id="email"
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          defaultValue={emailDefault}
        />
        <AuthField
          id="password"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <Button className="h-11" type="submit" disabled={pending}>
          Create account
        </Button>
      </form>
    </AuthScreen>
  );
}
