"use client";

import { useState, type FormEvent } from "react";
import { AppBar } from "@/components/chrome";
import { authClient } from "@/auth/client";

export default function LoginPage() {
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
    window.location.assign("/");
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
          <a href="/signup">Create an account</a>
        </p>
      </main>
    </div>
  );
}
