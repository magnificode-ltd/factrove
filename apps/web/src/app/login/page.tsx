"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/auth/client";
import { authPageHref, safeNextPath } from "@/auth/return-path";
import { AppBar } from "@/components/chrome";

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
    <div className="library-page">
      <AppBar />
      <main className="catalog">
        <h1 className="page-title">Sign in</h1>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? (
            <p role="alert" className="banner error">
              {error}
            </p>
          ) : null}
          <button className="action" type="submit" disabled={pending}>
            Sign in
          </button>
        </form>
        <p className="mode">
          <a href={authPageHref("signup", next)}>Create an account</a>
        </p>
      </main>
    </div>
  );
}
