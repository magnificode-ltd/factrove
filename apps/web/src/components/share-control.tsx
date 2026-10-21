"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { KeyRound, Link2, LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { toast } from "sonner";
import { FactroveApiError } from "@factrove/api-client";
import { sharePasswordSchema, type ShareState } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { CopyButton } from "@/components/copy-button";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Pending = "share" | "revoke" | "password" | "remove-password" | null;

export function ShareControl({
  artifactId,
  initial,
  viewerUrl,
  showCopyLink = false,
  compact = false
}: {
  artifactId: string;
  initial: ShareState;
  viewerUrl?: string;
  showCopyLink?: boolean;
  compact?: boolean;
}) {
  const [share, setShare] = useState(initial);
  const [expanded, setExpanded] = useState(compact && Boolean(initial.shareUrl));
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const panelId = `public-link-${artifactId}`;
  const link = share.shareUrl ?? viewerUrl ?? "";
  const buttonClass = compact ? "h-8" : "h-10";

  useEffect(() => {
    if (compact || !expanded) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [compact, expanded]);

  useEffect(() => {
    if (!returnFocus.current) {
      return;
    }
    returnFocus.current = false;
    toggleRef.current?.focus();
  }, [expanded, pending, share.shared]);

  async function onShare() {
    if (share.shareUrl) {
      setExpanded((open) => !open);
      setError(null);
      try {
        const envelope = await createWebClient().getArtifactShare(artifactId);
        setShare(envelope.share);
      } catch (caught) {
        setError(shareError(caught, artifactId));
      }
      return;
    }
    setPending("share");
    setError(null);
    try {
      const client = createWebClient();
      const envelope = await client.createArtifactShare(artifactId);
      setShare(envelope.share);
      setExpanded(Boolean(envelope.share.shareUrl));
      if (!share.shared && envelope.share.shared) {
        toast.success("Public link created");
      }
    } catch (caught) {
      setError(shareError(caught, artifactId));
    } finally {
      setPending(null);
    }
  }

  async function onRevoke() {
    setPending("revoke");
    setError(null);
    try {
      const envelope = await createWebClient().revokeArtifactShare(artifactId);
      returnFocus.current = true;
      setShare(envelope.share);
      setExpanded(false);
      toast.success("Public link revoked");
    } catch (caught) {
      setError(shareError(caught, artifactId));
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "pointer-events-auto relative z-10 flex flex-wrap items-center gap-2",
        compact ? "flex-col items-stretch" : "",
        compact && expanded ? "w-full" : "w-auto"
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded && !compact && !event.defaultPrevented) {
          event.preventDefault();
          returnFocus.current = true;
          setExpanded(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={toggleRef}
          type="button"
          variant={share.shared ? "default" : "outline"}
          className={cn(buttonClass, share.shared ? "" : "bg-white")}
          aria-expanded={expanded}
          aria-controls={panelId}
          disabled={pending !== null}
          onClick={() => void onShare()}
        >
          {share.passwordProtected ? <LockKeyhole aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          {shareToggleLabel(pending, share.shared)}
          {share.passwordProtected ? <span className="sr-only">, password protected</span> : null}
        </Button>
        {showCopyLink && link ? (
          <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={link} />
        ) : null}
      </div>
      {expanded && share.shareUrl ? (
        <div
          className={
            compact
              ? "basis-full"
              : "absolute top-full right-0 z-40 mt-2 max-h-[calc(100dvh-6rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-[14px] shadow-[0_24px_48px_-24px_color-mix(in_srgb,var(--peri-d)_60%,transparent)]"
          }
        >
          <div
            id={panelId}
            role="region"
            aria-label="Public link"
            className="ft-pop ft-key rounded-[14px] border border-line bg-lilac p-4"
          >
            <p className="text-sm font-medium">
              {share.passwordProtected
                ? "Anyone with this link and its password can open the artifact without an account."
                : "Anyone with this link can open the artifact without an account."}
            </p>
            <code className="ft-reveal mt-3 block font-mono text-sm break-all" data-testid="share-url">
              {share.shareUrl}
            </code>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={share.shareUrl} />
              <Button
                type="button"
                variant="destructive"
                className="h-10"
                disabled={pending !== null}
                onClick={() => void onRevoke()}
              >
                {pending === "revoke" ? "Stopping…" : "Stop sharing"}
              </Button>
            </div>
            <SharePassword
              artifactId={artifactId}
              share={share}
              pending={pending}
              setPending={setPending}
              onChange={(next) => {
                setShare(next);
                setError(null);
              }}
              onError={(caught) => setError(shareError(caught, artifactId))}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SharePassword({
  artifactId,
  share,
  pending,
  setPending,
  onChange,
  onError
}: {
  artifactId: string;
  share: ShareState;
  pending: Pending;
  setPending: (pending: Pending) => void;
  onChange: (share: ShareState) => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const protectedLink = share.passwordProtected;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editRef.current?.focus();
    }
  }, [editing, protectedLink]);

  function close() {
    restoreFocus.current = true;
    setEditing(false);
    setPassword("");
    setInvalid(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = sharePasswordSchema.safeParse(password);
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? "Use 10 to 128 characters.");
      inputRef.current?.focus();
      return;
    }
    setPending("password");
    try {
      const envelope = await createWebClient().createArtifactShare(artifactId, { password: parsed.data });
      onChange(envelope.share);
      toast.success(protectedLink ? "Password changed" : "Password set", {
        description: "Anyone who unlocked the old password has to unlock again."
      });
      close();
    } catch (caught) {
      onError(caught);
    } finally {
      setPending(null);
    }
  }

  async function onRemove() {
    setPending("remove-password");
    try {
      const envelope = await createWebClient().removeArtifactSharePassword(artifactId);
      restoreFocus.current = true;
      onChange(envelope.share);
      toast.success("Password removed");
    } catch (caught) {
      onError(caught);
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Link password"
      data-testid="share-password"
      data-protected={protectedLink ? "true" : "false"}
      className="mt-4 rounded-[12px] border border-line bg-white p-3"
    >
      <div
        data-testid="share-password-layout"
        className={
          protectedLink
            ? "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3"
            : "flex flex-wrap items-center gap-3"
        }
      >
        <span
          key={protectedLink ? "locked" : "open"}
          aria-hidden="true"
          className={cn(
            "ft-lock-chip grid size-9 shrink-0 place-items-center rounded-full",
            protectedLink ? "bg-peri-d text-white" : "bg-lilac text-ink"
          )}
        >
          {protectedLink ? <LockKeyhole className="size-4" /> : <LockKeyholeOpen className="size-4" />}
        </span>
        <p
          data-testid="share-password-copy"
          className="min-w-0 flex-1 text-sm"
          role={share.guessesLockedOut ? "alert" : "status"}
        >
          <span className="font-semibold">{protectedLink ? "Password protected" : "No password"}</span>
          <span className={share.guessesLockedOut ? "block text-destructive" : "block text-muted-foreground"}>
            {share.guessesLockedOut
              ? "Too many wrong guesses: revoke and share again for a fresh link"
              : protectedLink
                ? "Visitors unlock it once per tab. Access lasts 15 minutes."
                : "Add one so only people you tell can open it."}
          </span>
        </p>
        {editing ? null : (
          <div
            data-testid="share-password-actions"
            className={cn("flex flex-wrap gap-2", protectedLink && "col-start-2")}
          >
            <Button
              ref={editRef}
              type="button"
              variant="outline"
              className="h-9 bg-white"
              disabled={pending !== null}
              onClick={() => setEditing(true)}
            >
              <KeyRound aria-hidden="true" />
              {protectedLink ? "Change password" : "Add password"}
            </Button>
            {protectedLink ? (
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={pending !== null}
                onClick={() => void onRemove()}
              >
                {pending === "remove-password" ? "Removing…" : "Remove password"}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {editing ? (
        <form className="ft-pop mt-3 grid gap-2" noValidate onSubmit={(event) => void onSubmit(event)}>
          <Label htmlFor={inputId}>{protectedLink ? "New link password" : "Link password"}</Label>
          <PasswordInput
            ref={inputRef}
            id={inputId}
            name="share-password"
            autoComplete="new-password"
            value={password}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => {
              setPassword(event.target.value);
              setInvalid(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            10 to 128 characters. Avoid common passwords. Share it separately from the link. Factrove stores only a hash.
          </p>
          {invalid ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {invalid}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-9" disabled={pending !== null}>
              <LockKeyhole aria-hidden="true" />
              {pending === "password" ? "Saving…" : protectedLink ? "Save new password" : "Set password"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={pending === "password"} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

export function shareToggleLabel(pending: Pending, shared: boolean): string {
  if (pending === "revoke") {
    return "Stopping…";
  }
  if (pending === "share") {
    return "Sharing…";
  }
  return shared ? "Sharing" : "Share";
}

function shareError(error: unknown, artifactId: string): string {
  if (error instanceof FactroveApiError && error.status === 401) {
    window.location.assign(authPageHref("login", `/artifacts/${artifactId}`));
    return "Sign in to continue.";
  }
  if (error instanceof FactroveApiError && error.message.trim().length > 0) {
    return error.message;
  }
  return "The public link could not be updated.";
}
