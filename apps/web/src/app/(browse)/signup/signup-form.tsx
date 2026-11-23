"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AuthField } from "@/components/auth-field";
import { AuthScreen } from "@/components/auth-screen";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import { invitationEmailSchema } from "@factrove/contracts";
import { authClient } from "@/auth/client";
import { invitationReturnPath, forgetInvitationReturn, rememberInvitationReturn, authPageHref, safeNextPath } from "@/auth/return-path";

const CAPTCHA_FAILED_MESSAGE = "Complete the check and try again.";
const CAPTCHA_UNAVAILABLE_MESSAGE = "The signup check could not be completed. Try again.";

export function SignupForm({ siteKey }: { siteKey?: string }) {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const inviteNext = invitationReturnPath(next);
  const invited = invitationEmailSchema.safeParse(params.get("email") ?? "");
  const emailDefault = invited.success ? invited.data : "";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (inviteNext) {
      rememberInvitationReturn(inviteNext);
      return;
    }
    forgetInvitationReturn();
  }, [inviteNext]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (siteKey && !token) {
      setError(CAPTCHA_FAILED_MESSAGE);
      return;
    }
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({
      name,
      email,
      password,
      ...(inviteNext ? { callbackURL: inviteNext } : {}),
      ...(siteKey && token ? { turnstileToken: token } : {}),
    });
    if (result.error) {
      setPending(false);
      setError(signupFailureMessage(result.error));
      if (siteKey) {
        setResetKey((value) => value + 1);
      }
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
        {siteKey ? (
          <TurnstileWidget
            siteKey={siteKey}
            resetKey={resetKey}
            onToken={setToken}
            onError={() => setError(CAPTCHA_UNAVAILABLE_MESSAGE)}
          />
        ) : null}
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

function signupFailureMessage(error: { message?: string; code?: string }): string {
  if (error.code === "CAPTCHA_FAILED") {
    return CAPTCHA_FAILED_MESSAGE;
  }
  if (error.code === "CAPTCHA_UNAVAILABLE") {
    return CAPTCHA_UNAVAILABLE_MESSAGE;
  }
  const message = error.message?.trim() ?? "";
  return message.length > 0 ? message : "Could not create the account.";
}
