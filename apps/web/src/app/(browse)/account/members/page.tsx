"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { FactroveApiError } from "@factrove/api-client";
import type { OrganizationMemberList } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { AppBar } from "@/components/chrome";
import { AuthField } from "@/components/auth-field";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const loginHref = authPageHref("login", "/account/members");

function roleLabel(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  return "Member";
}

function expiryLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} UTC`;
}

function redirectFor(error: FactroveApiError): boolean {
  if (error.status === 401) {
    window.location.assign(loginHref);
    return true;
  }
  if (error.status === 403 && error.code === "ORGANIZATION_SETUP_REQUIRED") {
    window.location.assign("/onboarding");
    return true;
  }
  return false;
}

export default function MembersPage() {
  const [page, setPage] = useState<OrganizationMemberList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(cursor: string | null, append: boolean) {
    try {
      const next = await createWebClient().listOrganizationMembers(cursor ? { cursor } : undefined);
      setPage((current) => {
        if (!append || !current) {
          return next;
        }
        return {
          ...next,
          members: [...current.members, ...next.members],
        };
      });
      setError(null);
    } catch (caught) {
      if (caught instanceof FactroveApiError && redirectFor(caught)) {
        return;
      }
      setError(caught instanceof FactroveApiError ? caught.message : "Members could not be loaded.");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    void load(null, false);
  }, []);

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      await createWebClient().createOrganizationInvitation(email);
      form.reset();
      toast.success("Invitation sent");
      await load(null, false);
    } catch (caught) {
      if (caught instanceof FactroveApiError && redirectFor(caught)) {
        return;
      }
      setError(caught instanceof FactroveApiError ? caught.message : "The invitation could not be sent.");
    } finally {
      setPending(false);
    }
  }

  async function onResend(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await createWebClient().resendOrganizationInvitation(id);
      toast.success("Invitation sent again");
      await load(null, false);
    } catch (caught) {
      if (caught instanceof FactroveApiError && redirectFor(caught)) {
        return;
      }
      setError(caught instanceof FactroveApiError ? caught.message : "The invitation could not be sent again.");
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await createWebClient().revokeOrganizationInvitation(id);
      toast.success("Invitation revoked");
      await load(null, false);
    } catch (caught) {
      if (caught instanceof FactroveApiError && redirectFor(caught)) {
        return;
      }
      setError(caught instanceof FactroveApiError ? caught.message : "The invitation could not be revoked.");
    } finally {
      setBusyId(null);
    }
  }

  const owner = page?.caller.role === "owner";

  return (
    <div className="ft-canvas min-h-dvh">
      <AppBar>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="h-8 bg-white">
            <a href="/">Back to library</a>
          </Button>
          <SignOutButton />
        </div>
      </AppBar>
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-semibold tracking-[0.16em] text-peri-d uppercase">Account</p>
        <h1 className="ft-title mt-2 text-4xl sm:text-5xl">Members</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          People in this organization.
          {owner ? " Invite someone by email. They join from the link in that message." : ""}
        </p>
        <div className={owner ? "mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" : "mt-8"}>
          {owner ? (
            <Card className="bg-white">
              <CardContent>
                <form className="grid gap-5" onSubmit={(event) => void onInvite(event)}>
                  <AuthField id="invite-email" name="email" label="Email" type="email" autoComplete="off" required />
                  <Button className="h-11" type="submit" disabled={pending}>
                    Send invitation
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-8">
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
            {loaded && page ? (
              <section aria-labelledby="member-roster">
                <h2 id="member-roster" className="text-lg font-semibold text-ink">
                  In this organization
                </h2>
                <ul className="mt-3 grid list-none gap-3 p-0" data-testid="member-roster">
                  {page.members.map((member) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-foreground/10"
                    >
                      <span>
                        <span className="font-medium text-ink">{member.name}</span>
                        {member.id === page.caller.id ? <span className="ml-2 text-sm text-muted-foreground">You</span> : null}
                        <span className="mt-0.5 block text-sm text-muted-foreground">{member.email}</span>
                      </span>
                      <span className="text-sm font-medium text-ink">{roleLabel(member.role)}</span>
                    </li>
                  ))}
                </ul>
                {page.nextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 h-10 bg-white"
                    onClick={() => void load(page.nextCursor, true)}
                  >
                    More members
                  </Button>
                ) : null}
              </section>
            ) : null}
            {loaded && owner && page ? (
              <section aria-labelledby="pending-invites">
                <h2 id="pending-invites" className="text-lg font-semibold text-ink">
                  Pending invitations
                </h2>
                {page.invitations.length === 0 ? (
                  <p role="status" className="mt-3 rounded-2xl bg-white px-5 py-4 text-base shadow-sm ring-1 ring-foreground/10">
                    No pending invitations.
                  </p>
                ) : (
                  <ul className="mt-3 grid list-none gap-3 p-0" data-testid="pending-invites">
                    {page.invitations.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-foreground/10"
                      >
                        <span>
                          <span className="font-medium text-ink">{invitation.email}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            Expires {expiryLabel(invitation.expiresAt)}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 bg-white"
                            disabled={busyId === invitation.id}
                            onClick={() => void onResend(invitation.id)}
                          >
                            Resend
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            className="h-10"
                            disabled={busyId === invitation.id}
                            onClick={() => void onRevoke(invitation.id)}
                          >
                            Revoke
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
