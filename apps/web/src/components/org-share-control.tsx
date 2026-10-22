"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OrgShareControl({
  artifactId,
  organizationName,
  compact = false,
  onShared,
  client
}: {
  artifactId: string;
  organizationName: string;
  compact?: boolean;
  onShared: (artifact: ArtifactDto) => void;
  client?: FactroveClient;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = `share-with-org-${artifactId}`;
  const label = `Share with ${organizationName}`;

  useEffect(() => {
    if (!open) {
      return;
    }
    cancelRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setError(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    setError(null);
    triggerRef.current?.focus();
  }

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const envelope = await (client ?? createWebClient()).shareArtifactWithOrganization(artifactId);
      onShared(envelope.artifact);
      setOpen(false);
      toast.success(`Shared with ${organizationName}`);
      requestAnimationFrame(() => {
        document.getElementById(`artifact-access-${artifactId}`)?.focus();
      });
    } catch (caught) {
      setError(shareWithOrganizationError(caught, artifactId));
    } finally {
      setPending(false);
    }
  }

  const dialog = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_32%,transparent)] p-4">
      <div
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="org-share-dialog"
        className="w-full max-w-md rounded-[14px] border border-border bg-white p-5 shadow-[0_24px_48px_-24px_color-mix(in_srgb,var(--peri-d)_60%,transparent)]"
        onKeyDown={trapTab}
      >
        <h2 id={titleId} className="text-lg font-extrabold tracking-tight text-ink">
          {label}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Members of {organizationName} will be able to view this artifact. This can&apos;t be undone from the UI yet.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="outline" className="h-10 bg-white" onClick={close}>
            Cancel
          </Button>
          <Button type="button" className="h-10" disabled={pending} onClick={() => void confirm()}>
            <Users aria-hidden="true" />
            {pending ? "Sharing…" : label}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className={cn(compact ? "h-8 bg-white" : "h-10 bg-white")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        data-testid="org-share-trigger"
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Users aria-hidden="true" />
        {label}
      </Button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}

function shareWithOrganizationError(error: unknown, artifactId: string): string {
  if (error instanceof FactroveApiError && error.status === 401) {
    window.location.assign(authPageHref("login", `/artifacts/${artifactId}`));
    return "Sign in to continue.";
  }
  if (error instanceof FactroveApiError && error.message.trim().length > 0) {
    return error.message;
  }
  return "The artifact could not be shared with the organization.";
}
