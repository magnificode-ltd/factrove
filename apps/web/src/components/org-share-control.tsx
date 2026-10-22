"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { createWebClient } from "@/api/client";
import { authPageHref } from "@/auth/return-path";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Audience = NonNullable<ContextEnvelope["organization"]>;

export function OrgShareControl({
  artifactId,
  organizationId,
  organizationName,
  compact = false,
  onShared,
  onAudienceChange,
  client
}: {
  artifactId: string;
  organizationId: string;
  organizationName: string;
  compact?: boolean;
  onShared: (artifact: ArtifactDto) => void;
  onAudienceChange?: (organization: ContextEnvelope["organization"]) => void;
  client?: FactroveClient;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>({ id: organizationId, name: organizationName });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dialogId = `share-with-org-${artifactId}`;

  useEffect(() => {
    setAudience({ id: organizationId, name: organizationName });
  }, [organizationId, organizationName]);

  useEffect(() => {
    if (open) {
      return;
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    focusEnabled(target);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const overlay = overlayRef.current;
    const background: HTMLElement[] = [];
    if (overlay) {
      for (const child of document.body.children) {
        if (child instanceof HTMLElement && child !== overlay && !child.inert) {
          child.inert = true;
          background.push(child);
        }
      }
    }
    cancelRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      returnFocusRef.current = triggerRef.current;
      setOpen(false);
      setError(null);
    };
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      if (event.target instanceof Node && dialog.contains(event.target)) {
        return;
      }
      if (!focusEnabled(confirmRef.current)) {
        focusEnabled(cancelRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      for (const element of background) {
        element.inert = false;
      }
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  function close() {
    returnFocusRef.current = triggerRef.current;
    setOpen(false);
    setError(null);
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
      event.preventDefault();
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
    if (pendingRef.current) {
      return;
    }
    const confirmed = audience;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    confirmRef.current?.focus();
    const api = client ?? createWebClient();
    let succeeded = false;
    try {
      const envelope = await api.shareArtifactWithOrganization(artifactId, confirmed.id);
      onShared(envelope.artifact);
      const name = await verifiedOrganizationName(api, envelope.artifact.organizationId, confirmed);
      toast.success(`Shared with ${isolate(name)}`);
      succeeded = true;
      setOpen(false);
    } catch (caught) {
      const nextAudience = await audienceAfterChange(api, caught);
      if (nextAudience !== undefined) {
        if (nextAudience === null) {
          onAudienceChange?.(null);
          setOpen(false);
        } else {
          setAudience(nextAudience);
          onAudienceChange?.(nextAudience);
          setError(caught instanceof FactroveApiError ? caught.message : null);
        }
      } else {
        setError(shareWithOrganizationError(caught, artifactId));
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
      const access = document.getElementById(`artifact-access-${artifactId}`);
      requestAnimationFrame(() => {
        if (succeeded) {
          focusEnabled(access);
          return;
        }
        if (dialogRef.current?.isConnected) {
          if (!focusEnabled(confirmRef.current)) {
            focusEnabled(cancelRef.current);
          }
          return;
        }
        if (!focusEnabled(access)) {
          focusEnabled(triggerRef.current);
        }
      });
    }
  }

  const label = `Share with ${audience.name}`;
  const dialog = open ? (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_32%,transparent)] p-4"
    >
      <div
        ref={dialogRef}
        id={dialogId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="org-share-dialog"
        className="w-full max-w-md overflow-hidden rounded-[14px] border border-border bg-white p-5 shadow-[0_24px_48px_-24px_color-mix(in_srgb,var(--peri-d)_60%,transparent)]"
        onKeyDown={trapTab}
      >
        <h2 id={titleId} className="break-words text-lg font-extrabold tracking-tight text-ink">
          Share with <bdi>{audience.name}</bdi>
        </h2>
        <p id={descriptionId} className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
          Members of <bdi>{audience.name}</bdi> will be able to view this artifact. This can&apos;t be undone from the UI yet.
        </p>
        {error ? (
          <p role="alert" className="mt-3 break-words text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="outline" className="h-10 max-w-full bg-white" onClick={close}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            className="h-auto min-h-10 max-w-full min-w-0 shrink whitespace-normal px-3"
            aria-busy={pending}
            aria-disabled={pending || undefined}
            onClick={() => void confirm()}
          >
            <Users aria-hidden="true" />
            <span className="min-w-0 truncate">{pending ? "Sharing…" : <>Share with <bdi>{audience.name}</bdi></>}</span>
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
        className={cn(
          "h-auto max-w-full min-w-0 shrink whitespace-normal bg-white px-3",
          compact ? "min-h-8" : "min-h-10"
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        data-testid="org-share-trigger"
        title={isolate(label)}
        onClick={() => {
          setError(null);
          setAudience({ id: organizationId, name: organizationName });
          setOpen(true);
        }}
      >
        <Users aria-hidden="true" />
        <span className="min-w-0 truncate">
          Share with <bdi>{organizationName}</bdi>
        </span>
      </Button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : null}
    </>
  );
}

function isolate(value: string): string {
  return `\u2068${value}\u2069`;
}

function focusEnabled(element: HTMLElement | null | undefined): boolean {
  if (!element?.isConnected || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
    return false;
  }
  element.focus();
  return document.activeElement === element;
}

async function verifiedOrganizationName(
  client: FactroveClient,
  organizationId: string | null,
  confirmed: Audience
): Promise<string> {
  try {
    const context = await client.getContext();
    if (context.organization && context.organization.id === organizationId) {
      return context.organization.name;
    }
  } catch {
    // The accepted organization id still names the audience the server stored.
  }
  return organizationId === confirmed.id ? confirmed.name : "your organization";
}

async function audienceAfterChange(
  client: FactroveClient,
  error: unknown
): Promise<ContextEnvelope["organization"] | undefined> {
  if (!(error instanceof FactroveApiError) || error.code !== "ORGANIZATION_CHANGED") {
    return undefined;
  }
  try {
    const context = await client.getContext();
    return context.organization;
  } catch {
    return undefined;
  }
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
