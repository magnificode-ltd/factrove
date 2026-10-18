"use client";

import { useState, type FormEvent } from "react";
import { AppBar } from "@/components/chrome";
import { authClient } from "@/auth/client";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    const result = await authClient.signUp.email({ name, email, password });
    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Could not create the account.");
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="library-page">
      <AppBar />
      <main className="catalog">
        <h1 className="page-title">Create account</h1>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Name
            <input name="name" autoComplete="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="new-password" minLength={8} required />
          </label>
          {error ? (
            <p role="alert" className="banner error">
              {error}
            </p>
          ) : null}
          <button className="action" type="submit" disabled={pending}>
            Create account
          </button>
        </form>
        <p className="mode">
          <a href="/login">Sign in</a>
        </p>
      </main>
    </div>
  );
}
