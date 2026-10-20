"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AppBar } from "@/components/chrome";
import { AuthField } from "@/components/auth-field";
import { CopyButton } from "@/components/copy-button";
import { ToastHost } from "@/components/toast-host";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const result = await authClient.apiKey.list();
    if (result.error) {
      if (result.error.status === 401) {
        window.location.assign(loginHref);
        return;
      }
      setError(result.error.message ?? "API keys could not be loaded.");
      setLoaded(true);
      return;
    }
    setItems(result.data?.apiKeys ?? []);
    setError(null);
    setLoaded(true);
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
    toast.success("API key created", { description: "Copy it now. It will not be shown again." });
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
    toast.success("API key revoked");
    await refresh();
  }

  return (
    <div className="ft-canvas min-h-dvh">
      <ToastHost />
      <AppBar>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="h-10">
            <a href="/">Back to library</a>
          </Button>
          <SignOutButton />
        </div>
      </AppBar>
      <main className="ft-enter mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-semibold tracking-[0.16em] text-peri-d uppercase">Account</p>
        <h1 className="ft-title mt-2 text-4xl sm:text-5xl">API keys</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          A new key is shown once. Factrove stores only a hash of the key.
        </p>
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card className="bg-white">
            <CardContent>
              <form className="grid gap-5" onSubmit={onCreate}>
                <AuthField id="key-name" name="name" label="Key name" autoComplete="off" required maxLength={32} />
                <Button className="h-11" type="submit" disabled={pending}>
                  Create API key
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="grid gap-4">
            {secret ? (
              <div role="status" className="ft-pop ft-key rounded-[14px] border border-line bg-lilac p-5">
                <p className="text-sm font-medium">Copy this key now. It will not be shown again.</p>
                <code className="ft-reveal mt-3 block font-mono text-sm break-all" data-testid="api-key-secret">
                  {secret}
                </code>
                <div className="mt-4">
                  <CopyButton value={secret} />
                </div>
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive" className="bg-white">
                <AlertDescription className="text-base text-destructive">{error}</AlertDescription>
              </Alert>
            ) : null}
            {!loaded ? (
              <div className="grid gap-3" aria-hidden="true">
                <Skeleton className="h-16 w-full rounded-2xl" />
                <Skeleton className="h-16 w-full rounded-2xl" />
              </div>
            ) : null}
            {loaded && items.length === 0 ? (
              <p role="status" className="rounded-2xl bg-white px-5 py-4 text-base shadow-sm ring-1 ring-foreground/10">
                No active API keys.
              </p>
            ) : null}
            {items.length > 0 ? (
              <ul className="grid list-none gap-3 p-0">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-foreground/10"
                  >
                    <span className="font-medium">
                      {item.name ?? "API key"} · <span className="font-mono text-sm">{item.start ?? ""}</span>
                    </span>
                    <Button variant="destructive" type="button" className="h-10" onClick={() => void onRevoke(item.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
