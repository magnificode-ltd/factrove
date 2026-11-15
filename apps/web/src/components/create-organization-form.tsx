"use client";

import { useState, type FormEvent } from "react";
import { createWebClient } from "@/api/client";
import { FactroveApiError } from "@factrove/api-client";
import { AuthField } from "@/components/auth-field";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";

export function CreateOrganizationForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setPending(true);
    setError(null);
    try {
      await createWebClient().createOrganization(name);
      window.location.assign("/");
    } catch (caught) {
      setPending(false);
      setError(caught instanceof FactroveApiError ? caught.message : "The organization could not be created.");
    }
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <AuthField id="organization-name" name="name" label="Organization name" autoComplete="organization" required />
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button className="h-11" type="submit" disabled={pending}>
        Create organization
      </Button>
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </form>
  );
}
