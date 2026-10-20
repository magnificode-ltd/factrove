"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AppBar } from "@/components/chrome";
import { SignOutButton } from "@/components/sign-out-button";
import { authClient } from "@/auth/client";
import { authPageHref } from "@/auth/return-path";

const loginHref = authPageHref("login", "/account/api-keys");

type ListedKey = {
  id: string;
  name: string | null;
  start: string | null;
};

export default function ApiKeysPage() {
  const [items, setItems] = useState<ListedKey[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function refresh() {
    const result = await authClient.apiKey.list();
    if (result.error) {
      if (result.error.status === 401) {
        window.location.assign(loginHref);
        return;
      }
      setError(result.error.message ?? "API keys could not be loaded.");
      return;
    }
    setItems(result.data?.apiKeys ?? []);
    setError(null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setPending(true);
    setError(null);
    const result = await authClient.apiKey.create({ name });
    setPending(false);
    if (result.error || !result.data?.key) {
      if (result.error?.status === 401) {
        window.location.assign(loginHref);
        return;
      }
      setError(result.error?.message ?? "The API key could not be created.");
      return;
    }
    setSecret(result.data.key);
    form.reset();
    await refresh();
  }

  async function onRevoke(id: string) {
    setError(null);
    const result = await authClient.apiKey.delete({ keyId: id });
    if (result.error) {
      if (result.error.status === 401) {
        window.location.assign(loginHref);
        return;
      }
      setError(result.error.message ?? "The API key could not be revoked.");
      return;
    }
    setSecret(null);
    await refresh();
  }

  return (
    <div className="library-page">
      <AppBar>
        <a className="back" href="/">
          Back to library
        </a>
        <SignOutButton />
      </AppBar>
      <main className="catalog">
        <h1 className="page-title">API keys</h1>
        <p className="mode">A new key is shown once. Factrove stores only a hash of the key.</p>
        <form className="auth-form" onSubmit={onCreate}>
          <label>
            Key name
            <input name="name" autoComplete="off" required maxLength={32} />
          </label>
          <button className="action" type="submit" disabled={pending}>
            Create API key
          </button>
        </form>
        {secret ? (
          <p role="status" className="banner">
            Copy this key now. It will not be shown again.
            <code className="secret" data-testid="api-key-secret">
              {secret}
            </code>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="banner error">
            {error}
          </p>
        ) : null}
        {items.length === 0 ? (
          <p role="status" className="banner">
            No active API keys.
          </p>
        ) : (
          <ul className="keys">
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.name ?? "API key"} · {item.start ?? ""}
                </span>
                <button className="action" type="button" onClick={() => void onRevoke(item.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
